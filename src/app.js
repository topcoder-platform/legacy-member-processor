/**
 * The application entry point
 */

global.Promise = require('bluebird')
const _ = require('lodash')
const config = require('config')
const logger = require('./common/logger')
const Kafka = require('no-kafka')
const co = require('co')
const ProcessorService = require('./services/ProcessorService')
const healthcheck = require('topcoder-healthcheck-dropin')

// create consumer
const options = { connectionString: config.KAFKA_URL }

logger.info("Starting the application........")
logger.info("KAFKA_URL - " + config.KAFKA_URL)
logger.info("KAFKA_CLIENT_CERT - " + config.KAFKA_CLIENT_CERT)
logger.info("KAFKA_CLIENT_CERT_KEY - " + config.KAFKA_CLIENT_CERT_KEY)

if (config.KAFKA_CLIENT_CERT && config.KAFKA_CLIENT_CERT_KEY) {
  options.ssl = { cert: config.KAFKA_CLIENT_CERT, key: config.KAFKA_CLIENT_CERT_KEY }
}
logger.info(options)
const consumer = new Kafka.SimpleConsumer(options)

// data handler
const dataHandler = (messageSet, topic, partition) => Promise.each(messageSet, (m) => {
  const message = m.message.value.toString('utf8')
  logger.info(`Handle Kafka event message; Topic: ${topic}; Partition: ${partition}; Offset: ${
    m.offset}; Message: ${message}.`)
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
  return co(function * () {
    switch (topic) {
      case config.CREATE_PROFILE_TOPIC:
        yield ProcessorService.createProfile(messageJSON)
        break
      case config.UPDATE_PROFILE_TOPIC:
        yield ProcessorService.updateProfile(messageJSON)
        break
      case config.UPDATE_PHOTO_TOPIC:
        yield ProcessorService.updatePhoto(messageJSON)
        break
      case config.EMAIL_CHANGE_VERIFICATION_TOPIC:
        yield ProcessorService.verifyEmailChange(messageJSON)
        break
      case config.CREATE_TRAIT_TOPIC:
        yield ProcessorService.createOrUpdateTrait(messageJSON)
        break
      case config.UPDATE_TRAIT_TOPIC:
        yield ProcessorService.createOrUpdateTrait(messageJSON)
        break
      default:
        throw new Error(`Invalid topic: ${topic}`)
    }
  })
    // commit offset
    .then(() => consumer.commitOffset({ topic, partition, offset: m.offset }))
    .catch((err) => logger.error(err))
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

consumer
  .init()
  // consume configured topics
  .then(() => {
    logger.info('Initilized.......')
    healthcheck.init([check])
    logger.info('Adding topics.......')
    const topics = [config.CREATE_PROFILE_TOPIC, config.UPDATE_PROFILE_TOPIC,
      config.CREATE_TRAIT_TOPIC, config.UPDATE_TRAIT_TOPIC,
      config.UPDATE_PHOTO_TOPIC, config.EMAIL_CHANGE_VERIFICATION_TOPIC]
    logger.info(topics)
    logger.info('Kick Start.......')
    _.each(topics, (tp) => consumer.subscribe(tp, { time: Kafka.LATEST_OFFSET }, dataHandler))
  })
  .catch((err) => logger.error(err))
