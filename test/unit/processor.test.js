/**
 * The test cases for Legacy member processor.
 */
global.Promise = require('bluebird')
const _ = require('lodash')
const config = require('config')
const should = require('should')
const processorService = require('../../src/services/ProcessorService')
const logger = require('../../src/common/logger')
const { getInformixConnection } = require('../../src/common/helper')
const { expectTable, runSql, assertErrorLogs } = require('../common/helper')
const {
  prepareSql,
  testMethods,
  createProfileMessage,
  updateTraitMessage,
  verifyEmailChangeInvalidHandleMessage
} = require('../common/testData')

describe('Legacy member processor Unit Tests', () => {
  let connection
  const infoLogs = []
  const errorLogs = []
  const info = logger.info
  const error = logger.error
  const assertErrorMessage = (message) => assertErrorLogs(errorLogs, message)
  /**
   * Assert validation error
   * @param err the error to validate
   * @param message the error message
   */
  const assertValidationError = (err, message) => {
    err.isJoi.should.be.true()
    should.equal(err.name, 'ValidationError')
    err.details.map(x => x.message).should.containEql(message)
    errorLogs.should.not.be.empty()
    errorLogs.should.containEql(err.stack)
  }
  before(async () => {
    // inject logger with log collector
    logger.info = (message) => {
      infoLogs.push(message)
      if (!config.DISABLE_LOGGING) {
        info(message)
      }
    }
    logger.error = (message) => {
      errorLogs.push(message)
      if (!config.DISABLE_LOGGING) {
        error(message)
      }
    }
    connection = await getInformixConnection()
  })
  beforeEach(async () => {
    // clear logs
    infoLogs.length = 0
    errorLogs.length = 0
    await runSql(prepareSql)
  })
  after(async () => {
    // restore logger
    logger.error = error
    logger.info = info
    try {
      await connection.closeAsync()
    } catch (e) {
      // ignore
    }
  })

  for (const testMethod of Object.keys(testMethods)) {
    let { testMessage, requiredFields, integerFields, stringFields, arrayFields, urlFields } = testMethods[testMethod]
    const isCreateProfile = testMethod === 'createProfile'
    const isUpdateProfile = testMethod === 'updateProfile'
    const isCreateOrUpdateTrait = testMethod === 'createOrUpdateTrait'
    const isUpdatePhoto = testMethod === 'updatePhoto'
    const isVerifyEmailChange = testMethod === 'verifyEmailChange'
    let payload = testMessage.payload
    let userId = _.get(payload, 'userId')
    if (!isCreateProfile && !isVerifyEmailChange) {
      it(`test ${testMethod} without profile in database`, async () => {
        await processorService[testMethod](testMessage)
        assertErrorMessage(`The user with id = ${userId} does not exist`)
      })
    }
    if (isCreateProfile) {
      it(`test createProfile with same message twice`, async () => {
        await processorService[testMethod](testMessage)
        try {
          await processorService[testMethod](testMessage)
          throw new Error('should not throw error here')
        } catch (e) {
          e.message.should.match(/Unique constraint/)
        }
      })
    }
    if (isCreateOrUpdateTrait) {
      it('test createOrUpdateTrait with wrong traitId', async () => {
        let message = _.cloneDeep(testMessage)
        message.payload.traitId = 'invalid'
        await processorService[testMethod](message)
        assertErrorMessage('The message is not for basic_info trait')
      })
      it('test updateTrait without country code', async () => {
        await processorService.createProfile(_.omit(testMethods.createProfile.testMessage, 'payload.photoURL'))
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
        await processorService[testMethod](message)
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
        let userParams = {
          user_id: userId,
          status: 'I'
        }
        await expectTable('user', 0, userParams)
        await expectTable('informixoltp:image', 0, imageParams)
        await processorService.createProfile(message)
        await expectTable('user', 1, userParams)
        await expectTable('informixoltp:image', 1, imageParams)
        await expectTable('informixoltp:coder_image_xref', 1, { coder_id: userId })
        await processorService[testMethod](testMessage)
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
        let userHandle = _.get(message, 'payload.data.userHandle')
        await processorService[testMethod](message)
        assertErrorMessage(`The user with handle = ${userHandle} does not exist`)
      })
    }
    it(`test ${testMethod} by valid message`, async () => {
      if (!isCreateProfile) {
        // create profile without photo url
        await processorService.createProfile(_.omit(testMethods.createProfile.testMessage, 'payload.photoURL'))
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
      }
      let userParams = {
        user_id: userId,
        first_name: _.get(payload, 'firstName', ''),
        last_name: _.get(payload, 'lastName', ''),
        handle: _.get(payload, 'handle', ''),
        status: _.get(payload, 'status', '') === 'ACTIVE' ? 'A' : 'I',
        name_in_another_language: _.get(payload, 'otherLangName', '')
      }
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
      let coderParams = {
        coder_id: userId,
        quote: _.get(payload, 'description', ''),
        home_country_code: _.get(payload, 'homeCountryCode', ''),
        comp_country_code: _.get(payload, 'competitionCountryCode', ''),
        display_quote: 1
      }
      let imageParams = {
        link: _.get(payload, 'photoURL', '')
      }
      if (_.get(payload, 'photoURL')) {
        await expectTable('informixoltp:coder_image_xref', 0, { coder_id: userId })
        await expectTable('informixoltp:image', 0, imageParams)
      }
      if (!isUpdatePhoto && isVerifyEmailChange) {
        await expectTable('user', 0, userParams)
        await expectTable('user_address_xref', isCreateProfile ? 0 : 1, { user_id: userId })
        await expectTable('informixoltp:coder', 0, coderParams)
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
          let addressParam = {
            address_type_id: addrTypeRow[0].address_type_id,
            address1: addr.streetAddr1,
            address2: addr.streetAddr2,
            city: addr.city,
            zip: addr.zip
          }
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
      await processorService[testMethod](message)
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

    for (const requiredField of requiredFields) {
      it(`test ${testMethod} message - invalid parameters, required field ${requiredField} is missing`, async () => {
        let message = _.cloneDeep(testMessage)
        message = _.omit(message, requiredField)
        try {
          await processorService[testMethod](message)
          throw new Error('should not throw error here')
        } catch (err) {
          assertValidationError(err, `"${_.last(requiredField.split('.'))}" is required`)
        }
      })
    }
    it(`test ${testMethod} message - invalid parameters, invalid timestamp`, async () => {
      let message = _.cloneDeep(testMessage)
      message.timestamp = 'invalid'
      try {
        await processorService[testMethod](message)
        throw new Error('should not throw error here')
      } catch (err) {
        assertValidationError(err, `"timestamp" must be a number of milliseconds or valid date string`)
      }
    })
    for (const stringField of stringFields) {
      it(`test ${testMethod} message - invalid parameters, invalid string type field ${stringField}`, async () => {
        let message = _.cloneDeep(testMessage)
        _.set(message, stringField, 123)
        try {
          await processorService[testMethod](message)
          throw new Error('should not throw error here')
        } catch (err) {
          assertValidationError(err, `"${_.last(stringField.split('.'))}" must be a string`)
        }
      })
    }
    if (integerFields) {
      for (const integerField of integerFields) {
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(wrong number)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, 'string')
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(integerField.split('.'))}" must be a number`)
          }
        })
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(wrong integer)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, 1.1)
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(integerField.split('.'))}" must be an integer`)
          }
        })
        it(`test ${testMethod} message - invalid parameters, invalid integer type field ${integerField}(negative)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, integerField, -1)
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            const fieldName = _.last(integerField.split('.'))
            assertValidationError(err, `"${fieldName}" must be larger than or equal to ${fieldName === 'phaseId' ? 0 : 1}`)
          }
        })
      }
    }
    if (arrayFields) {
      for (const arrayField of arrayFields) {
        it(`test ${testMethod} message - invalid parameters, invalid array type field ${arrayField}(wrong array type)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, arrayField, 'invalidArray')
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(arrayField.split('.'))}" must be an array`)
          }
        })
        it(`test ${testMethod} message - invalid parameters, invalid array type field ${arrayField}(empty array)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, arrayField, [])
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(arrayField.split('.'))}" must contain 1 items`)
          }
        })
      }
    }
    if (urlFields) {
      for (const urlField of urlFields) {
        it(`test ${testMethod} message - invalid parameters, invalid url type field ${urlField}(wrong url string type)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, urlField, 123)
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(urlField.split('.'))}" must be a string`)
          }
        })
        it(`test ${testMethod} message - invalid parameters, invalid url type field ${urlField}(invalid url string)`, async () => {
          let message = _.cloneDeep(testMessage)
          _.set(message, urlField, 'invalidurl')
          try {
            await processorService[testMethod](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(urlField.split('.'))}" must be a valid uri`)
          }
        })
      }
    }
  }
})
