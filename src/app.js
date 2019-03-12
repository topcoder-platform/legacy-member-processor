/**
 * The application entry point
 */

global.Promise = require('bluebird')
const config = require('config')
const Kafka = require('no-kafka')
const healthcheck = require('topcoder-healthcheck-dropin')
const logger = require('./common/logger')
const { getKafkaOptions } = require('./common/helper')
const ProcessorService = require('./services/ProcessorService')
// create consumer
const options = getKafkaOptions()

console.log('DISABLE_LOGGING :: ' + config.DISABLE_LOGGING)
console.log('DISABLE_LOGGING :: ' + typeof (config.DISABLE_LOGGING))

logger.info('Starting the application........')
logger.info('KAFKA_URL - ' + config.KAFKA_URL)
logger.info('KAFKA_CLIENT_CERT - ' + config.KAFKA_CLIENT_CERT)
logger.info('KAFKA_CLIENT_CERT_KEY - ' + config.KAFKA_CLIENT_CERT_KEY)

logger.info('IFX_SERVER - ' + config.IFX_SERVER)
logger.info('IFX_DATABASE - ' + config.IFX_DATABASE)
logger.info('INFORMIX_HOST - ' + config.INFORMIX_HOST)
logger.info(options)
const consumer = new Kafka.GroupConsumer(options)

// data handler
const dataHandler = async (messageSet, topic, partition) => Promise.each(messageSet, async (m) => {
  const message = m.message.value.toString('utf8')
  logger.info(`Handle Kafka event message; Topic: ${topic}; Partition: ${partition}; Offset: ${m.offset}; Message: ${message}.`)
  let messageJSON
  try {
    messageJSON = JSON.parse(message)
  } catch (e) {
    logger.error('Invalid message JSON.')
    logger.error(e)
    // ignore the message
    return
  }
  if (messageJSON.topic !== topic) {
    logger.error(`The message topic ${messageJSON.topic} doesn't match the Kafka topic ${topic}.`)
    // ignore the message
    return
  }
  try {
    switch (topic) {
      case config.CREATE_PROFILE_TOPIC:
        await ProcessorService.createProfile(messageJSON)
        break
      case config.UPDATE_PROFILE_TOPIC:
        await ProcessorService.updateProfile(messageJSON)
        break
      case config.UPDATE_PHOTO_TOPIC:
        await ProcessorService.updatePhoto(messageJSON)
        break
      case config.EMAIL_CHANGE_VERIFICATION_TOPIC:
        await ProcessorService.verifyEmailChange(messageJSON)
        break
      case config.CREATE_TRAIT_TOPIC:
        await ProcessorService.createOrUpdateTrait(messageJSON)
        break
      case config.UPDATE_TRAIT_TOPIC:
        await ProcessorService.createOrUpdateTrait(messageJSON)
        break
      default:
        throw new Error(`Invalid topic: ${topic}`)
    }
    // only commit if no errors
    await consumer.commitOffset({ topic, partition, offset: m.offset })
    logger.debug('Successfully processed message')
  } catch (err) {
    logger.error(err.message)
  }
})

// check if there is kafka connection alive
function check () {
  if (!consumer.client.initialBrokers && !consumer.client.initialBrokers.length) {
    return false
  }
  let connected = true
  consumer.client.initialBrokers.forEach(conn => {
    logger.debug(`url ${conn.server()} - connected=${conn.connected}`)
    connected = conn.connected & connected
  })
  return connected
}

const topics = [config.CREATE_PROFILE_TOPIC, config.UPDATE_PROFILE_TOPIC,
  config.CREATE_TRAIT_TOPIC, config.UPDATE_TRAIT_TOPIC,
  config.UPDATE_PHOTO_TOPIC, config.EMAIL_CHANGE_VERIFICATION_TOPIC]
consumer
  .init([{
    subscriptions: topics,
    handler: dataHandler
  }])
  // consume configured topics
  .then(() => {
    logger.info('Initilized.......')
    healthcheck.init([check])
    logger.info('Adding topics successfully.......')
    logger.info(topics)
    logger.info('Kick Start.......')
  })
  .catch((err) => logger.error(err))
if (process.env.NODE_ENV === 'test') {
  module.exports = consumer
}
