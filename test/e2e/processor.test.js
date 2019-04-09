/**
 * The test cases for Legacy member processor.
 */
global.Promise = require('bluebird')
const _ = require('lodash')
const axios = require('axios')
const Kafka = require('no-kafka')
const config = require('config')
const should = require('should')
const logger = require('../../src/common/logger')
const { getKafkaOptions, getInformixConnection } = require('../../src/common/helper')
const { sleep, expectTable, runSql, assertErrorLogs } = require('../common/helper')
const {
  prepareSql,
  testMethods,
  createProfileMessage,
  updateTraitMessage,
  verifyEmailChangeInvalidHandleMessage
} = require('../common/testData')
const kafkaOptions = getKafkaOptions()
const WAIT_TIME = config.WAIT_TIME
describe('Legacy member processor e2e Tests', () => {
  let connection
  let appConsumer
  const infoLogs = []
  const errorLogs = []
  const debugLogs = []
  const debug = logger.debug
  const info = logger.info
  const error = logger.error
  const assertErrorMessage = (message) => assertErrorLogs(errorLogs, message)

  const producer = new Kafka.Producer(kafkaOptions)

  /**
   * Clear logs
   */
  const clearLogs = () => {
    infoLogs.length = 0
    errorLogs.length = 0
    debugLogs.length = 0
  }
  /**
   * Send message
   * @param testMessage the test message
   */
  const sendMessage = async (testMessage) => {
    await producer.send({
      topic: testMessage.topic,
      message: {
        value: JSON.stringify(testMessage)
      }
    })
  }
  /**
   * Consume not committed messages before e2e test
   */
  const consumeMessages = async () => {
    // remove all not processed messages
    const consumer = new Kafka.GroupConsumer(kafkaOptions)
    await consumer.init([{
      subscriptions: [config.CREATE_PROFILE_TOPIC, config.UPDATE_PROFILE_TOPIC, config.UPDATE_PHOTO_TOPIC],
      handler: (messageSet, topic, partition) => Promise.each(messageSet, (m) => consumer.commitOffset({ topic, partition, offset: m.offset }))
    }])
    // make sure process all not committed messages before test
    await sleep(2 * WAIT_TIME)
    await consumer.end()
  }
  // the message patter to get topic/partition/offset
  const messagePattern = /^Handle Kafka event message; Topic: (.+); Partition: (.+); Offset: (.+); Message: (.+).$/
  /**
   * Wait job finished with successful log or error log is found
   */
  const waitJob = async () => {
    while (true) {
      if (errorLogs.length > 0) {
        if (infoLogs.length && messagePattern.exec(infoLogs[0])) {
          const matchResult = messagePattern.exec(infoLogs[0])
          // only manually commit for error message during test
          await appConsumer.commitOffset({
            topic: matchResult[1],
            partition: parseInt(matchResult[2]),
            offset: parseInt(matchResult[3])
          })
        }
        break
      }
      if (debugLogs.some(x => String(x).includes('Successfully processed message'))) {
        break
      }
      // use small time to wait job and will use global timeout so will not wait too long
      await sleep(WAIT_TIME)
    }
  }
  before(async () => {
    // inject logger with log collector
    logger.info = (message) => {
      infoLogs.push(message)
      if (!config.DISABLE_LOGGING) {
        info(message)
      }
    }
    logger.debug = (message) => {
      debugLogs.push(message)
      if (!config.DISABLE_LOGGING) {
        debug(message)
      }
    }
    logger.error = (message) => {
      errorLogs.push(message)
      if (!config.DISABLE_LOGGING) {
        error(message)
      }
    }
    await consumeMessages()
    // start kafka producer
    await producer.init()
    // start the application (kafka listener)
    appConsumer = require('../../src/app')
    // wait until consumer init successfully
    while (true) {
      if (infoLogs.some(x => String(x).includes('Kick Start'))) {
        break
      }
      await sleep(WAIT_TIME)
    }
    connection = await getInformixConnection()
  })
  beforeEach(async () => {
    // clear logs
    clearLogs()
    await runSql(prepareSql)
  })
  after(async () => {
    // restore logger
    logger.error = error
    logger.info = info
    logger.debug = debug
    try {
      await producer.end()
    } catch (err) {
      // ignore
    }
    try {
      await appConsumer.end()
    } catch (err) {
      // ignore
    }
    try {
      await connection.closeAsync()
    } catch (e) {
      // ignore
    }
  })
  it('Should setup healthcheck with check on kafka connection', async () => {
    const healthcheckEndpoint = `http://localhost:${process.env.PORT || 3000}/health`
    let result = await axios.get(healthcheckEndpoint)
    should.equal(result.status, 200)
    should.deepEqual(result.data, { checksRun: 1 })
    debugLogs.should.match(/connected=true/)
  })

  it('Should handle invalid json message', async () => {
    const { testMessage } = testMethods.createProfile
    await producer.send({
      topic: testMessage.topic,
      message: {
        value: '[ { - a b c'
      }
    })
    await waitJob()
    should.equal(errorLogs[0], 'Invalid message JSON.')
  })
  it('Should handle wrong topic message', async () => {
    const { testMessage } = testMethods.createProfile
    let message = _.cloneDeep(testMessage)
    message.topic = 'invalid'
    await producer.send({
      topic: testMessage.topic,
      message: {
        value: JSON.stringify(message)
      }
    })
    await waitJob()
    should.equal(errorLogs[0], `The message topic ${message.topic} doesn't match the Kafka topic ${testMessage.topic}.`)
  })
  for (const testMethod of Object.keys(testMethods)) {
    const { testMessage, requiredFields, integerFields, stringFields, arrayFields, urlFields } = testMethods[testMethod]
    const isCreateProfile = testMethod === 'createProfile'
    const isUpdateProfile = testMethod === 'updateProfile'
    const isCreateOrUpdateTrait = testMethod === 'createOrUpdateTrait'
    const isUpdatePhoto = testMethod === 'updatePhoto'
    const isVerifyEmailChange = testMethod === 'verifyEmailChange'
    let payload = testMessage.payload
    let userId = _.get(payload, 'userId')
    if (!isCreateProfile && !isVerifyEmailChange) {
      it(`test ${testMethod} without profile in database`, async () => {
        await sendMessage(testMessage)
        await waitJob()
        assertErrorMessage(`The user with id = ${userId} does not exist`)
      })
    }
    if (isCreateProfile) {
      it(`test createProfile with same message twice`, async () => {
        await sendMessage(testMessage)
        await waitJob()
        clearLogs()
        await sendMessage(testMessage)
        await waitJob()
        assertErrorMessage('Unique constraint')
      })
    }
    if (isCreateOrUpdateTrait) {
      it('test createOrUpdateTrait with wrong traitId', async () => {
        let message = _.cloneDeep(testMessage)
        message.payload.traitId = 'invalid'
        await sendMessage(message)
        await waitJob()
        assertErrorMessage('The message is not for basic_info trait')
      })
      it('test updateTrait without country code', async () => {
        await sendMessage(_.omit(testMethods.createProfile.testMessage, 'payload.photoURL'))
        await waitJob()
        let message = _.cloneDeep(updateTraitMessage)
        _.set(message, 'payload.traits.data[0].firstName', `${testMethod}FirstName`)
        _.set(message, 'payload.traits.data[0].email', `${testMethod}@test.com`)
        let data = _.get(message, 'payload.traits.data[0]')
        message = _.omit(message, 'payload.traits.data[0].country')
        should.exist(data.addresses)
        should.equal(data.addresses.length, 1)
        const addr = data.addresses[0]
        const addrTypeRow = await connection.queryAsync(`select address_type_id from address_type_lu where upper(address_type_desc) = '${addr.type}'`)
        const addressParam = {
          address_type_id: addrTypeRow[0].address_type_id,
          address1: addr.streetAddr1,
          address2: addr.streetAddr2,
          city: addr.city,
          zip: addr.zip,
          country_code: null
        }
        await expectTable('address', 0, addressParam)
        clearLogs()
        await sendMessage(message)
        await waitJob()
        await expectTable('address', 1, addressParam)
      })
    }
    if (isUpdatePhoto) {
      it('test updatePhoto for profile with photo url in database', async () => {
        should.exist(payload.photoURL)
        let message = _.cloneDeep(createProfileMessage)
        const userId = _.get(message, 'payload.userId')
        message.payload.status = 'INACTIVE'
        let initImageId = 1000
        let initPhotoUrl = message.payload.photoURL
        await runSql(`insert into informixoltp:image(image_id, image_type_id, link, modify_date) values(${initImageId}, 1, '${initPhotoUrl}', current)`)
        let imageParams = {
          image_id: initImageId + 1,
          link: initPhotoUrl
        }
        let userParams_ = {
          user_id: userId,
          status: 'I'
        }
        await expectTable('user', 0, userParams_)
        await expectTable('informixoltp:image', 0, imageParams)
        clearLogs()
        await sendMessage(message)
        await waitJob()
        await expectTable('user', 1, userParams_)
        await expectTable('informixoltp:image', 1, imageParams)
        await expectTable('informixoltp:coder_image_xref', 1, { coder_id: userId })
        clearLogs()
        await sendMessage(testMessage)
        await waitJob()
        await expectTable('informixoltp:coder_image_xref', 1, { coder_id: userId })
        await expectTable('informixoltp:image', 0, imageParams)
        // update exist image link
        imageParams.link = payload.photoURL
        await expectTable('informixoltp:image', 1, imageParams)
      })
    }
    if (isVerifyEmailChange) {
      it('test verifyEmailChange with invalid handle in database', async () => {
        let message = verifyEmailChangeInvalidHandleMessage
        let handle = _.get(message, 'payload.data.handle')
        await sendMessage(message)
        await waitJob()
        assertErrorMessage(`The user with handle = ${handle} does not exist`)
      })
    }
    it(`test ${testMethod} by valid message`, async () => {
      if (!isCreateProfile) {
        // create profile without photo url
        await sendMessage(_.omit(testMethods.createProfile.testMessage, 'payload.photoURL'))
        await waitJob()
      }
      let message = _.cloneDeep(testMessage)
      if (isCreateOrUpdateTrait) {
        _.set(message, 'payload.traits.data[0].firstName', `${testMethod}FirstName`)
        _.set(message, 'payload.traits.data[0].email', `${testMethod}@test.com`)
        payload = _.get(message, 'payload.traits.data[0]')
        // assume exist valid country in sample message for createOrUpdateTrait
        should.exist(payload.country)
      }
      if (isUpdatePhoto) {
        // assume exist valid photo url in sample message for updatePhoto
        should.exist(payload.photoURL)
      }
      if (isVerifyEmailChange) {
        userId = _.get(testMethods.createProfile.testMessage, 'payload.userId')
        const payload_ = _.get(testMethods.createProfile.testMessage, 'payload')
        if (payload_) {
          payload = Object.assign(payload, {
            first_name: _.get(payload_, 'firstName'),
            last_name: _.get(payload_, 'lastName'),
            handle: _.get(payload_, 'handle'),
            status: _.get(payload_, 'status'),
            name_in_another_language: _.get(payload_, 'otherLangName')
          })
        }
      }
      let rawUserParams = {
        user_id: userId,
        first_name: _.get(payload, 'firstName'),
        last_name: _.get(payload, 'lastName'),
        handle: _.get(payload, 'handle'),
        status: _.get(payload, 'status') === 'ACTIVE' ? 'A' : 'I',
        name_in_another_language: _.get(payload, 'otherLangName')
      }
      let userParams = _.omitBy(rawUserParams, _.isUndefined)
      if (isUpdateProfile) {
        // cannot update user handle
        userParams = _.omit(userParams, 'handle')
      }
      if (isCreateOrUpdateTrait) {
        userParams = _.omit(userParams, ['handle', 'name_in_another_language'])
      }
      let emailParams = {
        user_id: userId,
        email_type_id: 1,
        address: _.get(payload, 'email', ''),
        primary_ind: 1,
        status_id: 1
      }
      if (isVerifyEmailChange) {
        emailParams.address = _.get(payload, 'recipients[0]')
      }
      let rawCoderParams = {
        coder_id: userId,
        quote: _.get(payload, 'description'),
        home_country_code: _.get(payload, 'homeCountryCode'),
        comp_country_code: _.get(payload, 'competitionCountryCode'),
        display_quote: 1
      }
      let coderParams = _.omitBy(rawCoderParams, _.isUndefined)
      let imageParams = {
        link: _.get(payload, 'photoURL', '')
      }
      if (_.get(payload, 'photoURL')) {
        await expectTable('informixoltp:coder_image_xref', 0, { coder_id: userId })
        await expectTable('informixoltp:image', 0, imageParams)
      }
      if (!isUpdatePhoto && isVerifyEmailChange) {
        await expectTable('user', 1, userParams)
        await expectTable('user_address_xref', isCreateProfile ? 0 : 1, { user_id: userId })
        await expectTable('informixoltp:coder', 1, coderParams)
      }
      if (!isUpdatePhoto) {
        await expectTable('email', 0, emailParams)
      }
      let countryCode
      let addressParams = []
      if (isCreateOrUpdateTrait) {
        countryCode = (await connection.queryAsync(`select country_code code from informixoltp:country where upper(country_name) = upper('${payload.country}')`))[0].code
      }
      if (!isUpdatePhoto && !isVerifyEmailChange) {
        for (let addr of payload.addresses) {
          const addrTypeRow = await connection.queryAsync(`select address_type_id from address_type_lu where upper(address_type_desc) = '${addr.type}'`)
          let rawAddressParam = {
            address_type_id: addrTypeRow[0].address_type_id,
            address1: addr.streetAddr1,
            address2: addr.streetAddr2,
            city: addr.city,
            zip: addr.zip
          }
          let addressParam = _.omitBy(rawAddressParam, _.isUndefined)
          if (countryCode) {
            addressParam.country_code = countryCode
          }
          if (addr.stateCode) {
            addressParam.state_code = addr.stateCode.substring(0, 2)
          }
          addressParams.push(addressParam)
          await expectTable('address', 0, addressParam)
        }
      }
      clearLogs()
      await sendMessage(message)
      await waitJob()
      for (let addressParam of addressParams) {
        await expectTable('address', 1, addressParam)
      }
      if (!isUpdatePhoto && !isVerifyEmailChange) {
        await expectTable('user', 1, userParams)
        payload.addresses.length.should.be.above(0) // actually always 1 but use general way
        await expectTable('user_address_xref', payload.addresses.length, { user_id: userId })

        await expectTable('informixoltp:coder', 1, coderParams)
      }
      if (!isUpdatePhoto) {
        await expectTable('email', 1, emailParams)
      }
      if (_.get(payload, 'photoURL')) {
        await expectTable('informixoltp:coder_image_xref', 1, { coder_id: userId })
        await expectTable('informixoltp:image', 1, imageParams)
      }
    })
    // could not send message if no topic
    for (const requiredField of requiredFields.filter(r => r !== 'topic')) {
      it(`test ${testMethod} message - invalid parameters, required field ${requiredField} is missing`, async () => {
        let message = _.cloneDeep(testMessage)
        message = _.omit(message, requiredField)
        await sendMessage(message)
        await waitJob()
        assertErrorMessage(`"${_.last(requiredField.split('.'))}" is required`)
      })
    }

    it(`test ${testMethod} message - invalid parameters, invalid timestamp`, async () => {
      let message = _.cloneDeep(testMessage)
      message.timestamp = 'invalid'
      await sendMessage(message)
      await waitJob()
      assertErrorMessage(`"timestamp" must be a number of milliseconds or valid date string`)
    })
    for (const stringField of stringFields.filter(x => x !== 'topic')) {
      it(`test ${testMethod} message - invalid parameters, invalid string type field ${stringField}`, async () => {
        let message = _.cloneDeep(testMessage)
        _.set(message, stringField, 123)
        await sendMessage(message)
        await waitJob()
        assertErrorMessage(`"${_.last(stringField.split('.'))}" must be a string`)
      })
    }
    if (integerFields) {
      for (const integerField of integerFields) {
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(wrong number)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, 'string')
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(integerField.split('.'))}" must be a number`)
        })
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(wrong integer)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, 1.1)
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(integerField.split('.'))}" must be an integer`)
        })
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(negative)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, -1)
          await sendMessage(message)
          await waitJob()
          errorLogs.should.not.be.empty()
          const fieldName = _.last(integerField.split('.'))
          assertErrorMessage(`"${fieldName}" must be larger than or equal to ${fieldName === 'phaseId' ? 0 : 1}`)
        })
      }
    }
    if (arrayFields) {
      for (const arrayField of arrayFields) {
        it(`test ${testMethod} message - invalid parameters, invalid array type field ${arrayField}(wrong array type)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, arrayField, 'invalidArray')
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(arrayField.split('.'))}" must be an array`)
        })
        it(`test ${testMethod} message - invalid parameters, invalid array type field ${arrayField}(empty array)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, arrayField, [])
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(arrayField.split('.'))}" must contain 1 items`)
        })
      }
    }
    if (urlFields) {
      for (const urlField of urlFields) {
        it(`test ${testMethod} message - invalid parameters, invalid url type field ${urlField}(wrong url string type)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, urlField, 123)
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(urlField.split('.'))}" must be a string`)
        })
        it(`test ${testMethod} message - invalid parameters, invalid url type field ${urlField}(invalid url string)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, urlField, 'invalidurl')
          await sendMessage(message)
          await waitJob()
          assertErrorMessage(`"${_.last(urlField.split('.'))}" must be a valid uri`)
        })
      }
    }
  }
})
