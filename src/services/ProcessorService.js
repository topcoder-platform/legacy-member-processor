/**
 * Service for member legacy processor for updating Informix database.
 */
const _ = require('lodash')
const Joi = require('joi')
const config = require('config')
const logger = require('../common/logger')
const { prepare, wrapTransaction } = require('../common/helper')

/**
 * Get user status from payload
 * @param payload the payload
 * @return {string} A if status of payload is equal to ACTIVE otherwise I
 */
const getStatus = (payload) => {
  const { status } = payload
  if (status) return status === 'ACTIVE' ? 'A' : 'I'
  return status
}

/**
 * Creates the coder image in the database ( in informixoltp:coder_image_xref table)
 * @param {Number} coderId The coder id
 * @param {String} photoUrl The photo url
 * @param {Object} connection  The connection object to Informix database
 */
async function createCoderImage (coderId, photoUrl, connection) {
  // create the coder image data in the database.
  // get the max image id from the DB
  const imgIdRow = await connection.queryAsync('select max(image_id) max_id from informixoltp:image')
  const imageId = imgIdRow[0].max_id == null ? 1000 : Number(imgIdRow[0].max_id) + 1

  // prepare the statement for image insert
  const insertImgStmt = await prepare(connection,
    'insert into informixoltp:image(image_id, image_type_id, link, modify_date) values(?, 1, ?, current)')

  // insert the image
  await insertImgStmt.executeAsync([imageId, photoUrl])

  // associate the image to the coder profile
  const createCoderImgStmt = await prepare(connection,
    'insert into informixoltp:coder_image_xref(coder_id, image_id, display_flag, modify_date) values(?, ?, 1, current)')
  await createCoderImgStmt.executeAsync([coderId, imageId])
}

/**
 * Creates the user profile in the database ( in common_oltp:user table)
 * @param {Object} payload The payload holding the user profile information
 * @param {*} connection  The connection object to Informix database
 */
async function createUserProfile (payload, connection) {
  const userId = _.get(payload, 'userId')
  const email = _.get(payload, 'email')

  // prepare the statement for inserting the user profile data to common_oltp.user table
  const rawPayload = {
    user_id: userId,
    first_name: _.get(payload, 'firstName'),
    last_name: _.get(payload, 'lastName'),
    handle: _.get(payload, 'userHandle') || _.get(payload, 'handle'),
    status: getStatus(payload),
    name_in_another_language: _.get(payload, 'otherLangName')
  }

  const normalizedPayload = _.omitBy(rawPayload, _.isUndefined)
  const keys = Object.keys(normalizedPayload)
  const count = keys.length
  const fields = ['create_date'].concat(keys)
  const values = ['current'].concat(_.fill(Array(count), '?'))

  const createUserStmt = await prepare(connection, `insert into user (${fields.join(', ')}) values (${values.join(', ')})`)

  // Execute the statement
  await createUserStmt.executeAsync(Object.values(normalizedPayload))

  // create the user email entry in the DB
  const insertEmailStmt = await prepare(connection,
    'insert into email(user_id, email_id, email_type_id, address, create_date, modify_date, primary_ind, status_id)' +
    ' values(?, sequence_email_seq.nextval, 1, ?, current, current, 1, 1)')

  await insertEmailStmt.executeAsync([userId, email])

  await createUserAddresses(payload, connection)
}

/**
 * Inserts the user data to informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
async function createCoderProfile (payload, connection) {
  const photoURL = _.get(payload, 'photoURL')
  const userId = _.get(payload, 'userId')

  const rawPayload = {
    coder_id: userId,
    quote:  _.get(payload, 'description'),
    home_country_code: _.get(payload, 'homeCountryCode'),
    comp_country_code: _.get(payload, 'competitionCountryCode')
  }
  const normalizedPayload = _.omitBy(rawPayload, _.isUndefined)

  const keys = Object.keys(normalizedPayload)
  const count = keys.length
  const fields = ['member_since', 'modify_date', 'display_quote'].concat(keys)
  const values = ['current', 'current', 1].concat(_.fill(Array(count), '?'))

  const createCoderDataStmt = await prepare(connection, `insert into informixoltp:coder(${fields.join(', ')}) values(${values.join(',')})`)

  // Create the coder data
  await createCoderDataStmt.executeAsync(Object.values(normalizedPayload))

  if (photoURL) {
    await createCoderImage(userId, photoURL, connection)
  }
}

/**
 * Create user profile in Informix database
 * @param {Object} message the message
 */
async function createProfile (message) {
  await wrapTransaction(async (connection) => {
    // create user data in common_oltp:user
    await createUserProfile(message.payload, connection)

    // create code data in informixoltp:coder
    await createCoderProfile(message.payload, connection)
  })
}

createProfile.schema = {
  message: Joi.object().keys({
    topic: Joi.string().required(),
    originator: Joi.string().required(),
    timestamp: Joi.date().required(),
    'mime-type': Joi.string().required(),
    payload: Joi.object().keys({
      userId: Joi.number().integer().min(1).required(),
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      email: Joi.string().email().required(),
      userHandle: Joi.string().required(),
      otherLangName: Joi.string().allow(''),
      description: Joi.string().allow(''),
      homeCountryCode: Joi.string().allow(''),
      competitionCountryCode: Joi.string().allow(''),
      photoURL: Joi.string().allow(''),
      addresses: Joi.array().items(Joi.object({
        type: Joi.string().required(),
        streetAddr1: Joi.string().required(),
        city: Joi.string().required(),
        stateCode: Joi.string().required(),
        zip: Joi.string().required(),
        countryCode: Joi.string().allow(''),
        streetAddr2: Joi.string().allow('')
      }).unknown(true))
    }).unknown(true).required()
  }).required()
}

/**
 * Sets the email of the user identified by userId to the given newEmail
 * @param {String} userId  The id of the for whom to update the email.
 * @param {String} newEmail The new user email to set
 * @param {Object} connection The connection to Informix database.
 */
async function updateUserEmail (userId, newEmail, connection) {
  if (newEmail === undefined) {
    logger.error('address is undefined')
    return
  }
  const updateEmailQuery = "update email set address = '" + newEmail + "' " +
                           'where user_id = ' + userId + ' and email_type_id = 1 and primary_ind = 1 ' +
                           'and status_id =1'
  await connection.queryAsync(updateEmailQuery)
}

/**
 * Updates the user profile in the database ( in common_oltp:user table)
 * @param {Object} payload The payload holding the user profile information
 * @param {*} connection  The connection object to Informix database
 */
async function updateUserProfile (payload, connection) {
  const userId = _.get(payload, 'userId')
  const email = _.get(payload, 'email')
  const addresses = _.get(payload, 'addresses')
  // prepare the query for updating the user in the database
  // as per Topcoder policy, the handle cannot be updated, hence it is removed from updated columns
  const rawPayload = {
    first_name: _.get(payload, 'firstName'),
    last_name: _.get(payload, 'lastName'),
    status: getStatus(payload),
    name_in_another_language: _.get(payload, 'otherLangName')
  }

  const normalizedPayload = _.omitBy(rawPayload, _.isUndefined)
  const keys = Object.keys(normalizedPayload)
  if (keys.length === 0) {
    logger.warn(`no valid payload`)
    return
  }

  const updateStatements = keys.map(key => `${key} = '${normalizedPayload[key]}'`).join(', ')

  const updateUserQuery = `update user set ${updateStatements} where user_id = ${userId}`
  await connection.queryAsync(updateUserQuery)

  // update the user email entry in the DB
  if (email !== undefined) {
    await updateUserEmail(userId, email, connection)
  }

  if (addresses !== undefined) {
    await updateUserAddresses(payload, connection)
  }
}

/**
 * Creates the user addresses using the payload data for profile create update
 * @param {Object} payload The profile create/update payload object
 * @param {*} connection The Informix DB connection
 */
async function createUserAddresses (payload, connection) {
  // iterate over the user addresses and create them in the db
  const userId = _.get(payload, 'userId')
  const createUserAddrStmt = await prepare(connection, 'insert into user_address_xref(user_id, address_id) values(?, ?)')
  for (let addr of _.get(payload, 'addresses', [])) {
    const rawPayload = Object.assign({
      address1: _.get(addr, 'streetAddr1'),
      city: _.get(addr, 'city'),
      state_code: _.get(addr, 'stateCode'),
      zip: _.get(addr, 'zip'),
      country_code: _.get(payload, 'countryCode'),
      address2: _.get(addr, 'streetAddr2')
    })

    const normalizedPayload = _.omitBy(rawPayload, _.isUndefined)
    const keys = Object.keys(normalizedPayload)
    const count = keys.length
    const fields = ['create_date', 'modify_date', 'address_id', 'address_type_id'].concat(keys)
    const values = ['current', 'current', '?', '?'].concat(_.fill(Array(count), '?'))

    // Insert the new user addresses into the database.
    const query = `insert into address(${fields.join(', ')}) values(${values.join(', ')})`
    const insertAddressStmt = await prepare(connection, query)

    // Get the address type id from the database.
    const addrTypeRow = await connection.queryAsync(`select address_type_id from address_type_lu where upper(address_type_desc) = '${addr.type}'`)

    // Get the address sequence next value to be used as address id.
    const addrIdRow = await connection.queryAsync('select first 1 sequence_address_seq.nextval from address')

    // insert the address into db
    const values_ = [addrIdRow[0].nextval, addrTypeRow[0].address_type_id].concat(Object.values(normalizedPayload))
    await insertAddressStmt.executeAsync(values_)

    // create the relationship between the user and the address
    await createUserAddrStmt.executeAsync([userId, addrIdRow[0].nextval])
  }
}

/**
 * Updates the user data in informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
async function updateCoderProfile (payload, connection) {
  const userId = _.get(payload, 'userId')
  const photoURL = _.get(payload, 'photoURL')

  // Get the CountryCode via IsoAplpha3Code from informix
  const homeCountryIsoAplpha3Code = _.get(payload, 'homeCountryCode')
  const competitionCountryIsoAplpha3Code = _.get(payload, 'competitionCountryCode')

  var homeCountryCode;
  var competitionCountryCode;

  if (homeCountryIsoAplpha3Code) {
    homeCountryCode = await connection.queryAsync("select country_code from informixoltp:country where upper(iso_alpha3_code) = upper('" + homeCountryIsoAplpha3Code + "')")
  }

  if (competitionCountryIsoAplpha3Code) {
    competitionCountryCode = await connection.queryAsync("select country_code from informixoltp:country where upper(iso_alpha3_code) = upper('" + competitionCountryIsoAplpha3Code + "')")
  }
  
  // prepare the query for updating the user in the database
  // as per Topcoder policy, the handle cannot be updated, hence it is removed from updated columns
  const rawPayload = {
    quote: _.get(payload, 'description'),
    home_country_code: homeCountryCode,
    comp_country_code: competitionCountryCode,
    display_quote: 1
  }

  const normalizedPayload = _.omitBy(rawPayload, _.isUndefined)
  const keys = Object.keys(normalizedPayload)
  if (keys.length === 0) {
    logger.warn(`no valid payload`)
    return
  }

  const updateStatements = keys.map(key => `${key} = '${normalizedPayload[key]}'`).join(', ')

  const updateCoderQuery = `update informixoltp:coder set ${updateStatements} where coder_id = ${userId}`

  await connection.queryAsync(updateCoderQuery)

  if (photoURL) {
    await updateCoderPhoto(userId, photoURL, connection)
  }
}

/**
 * Updates the coder photo in informixoltp:image and informixoltp:coder_image_xref
 * @param {String} coderId The coder id
 * @param {String} photoUrl  The url of the new photo to set for the coder
 * @param {Object} connection The connection to Informix database.
 */
async function updateCoderPhoto (coderId, photoUrl, connection) {
  // get the id of the existing image
  const existingImg = await connection.queryAsync(
    'select image_id id from informixoltp:coder_image_xref where ' +
    'coder_id= ' + coderId + ' and display_flag=1'
  )

  if (existingImg.length === 0) { // The coder does not have an existing image, we insert a new one
    // create the coder image data in the database.
    await createCoderImage(coderId, photoUrl, connection)
  } else { // The coder already have an existing image, we only update the image link
    await connection.queryAsync("update informixoltp:image set link='" + photoUrl + "' " +
                         'where image_id=' + existingImg[0].id)
  }
}

/**
 * Updates the user addresses in the Informix database
 * @param {Object} payload The payload containing the addresses data
 * @param {Object} connection The informix connection object
 */
async function updateUserAddresses (payload, connection) {
  // cleanup the existing user addresses
  // get and save the ids of the existing user addresses
  const userExistingAddrsIds = await connection.queryAsync(
    'select * from user_address_xref where user_id = ' + _.get(payload, 'userId'))
  // Delete all user addresses references
  const deleteUserAddrsStmt = await prepare(connection,
    'delete from user_address_xref where user_id = ?')
  deleteUserAddrsStmt.execute([_.get(payload, 'userId')])

  // cleanup the addresses from the address table
  const cleanupAddrsStmt = await prepare(connection,
    'delete from address where address_id = ?')
  for (let addr of userExistingAddrsIds) {
    await cleanupAddrsStmt.executeAsync([addr.address_id])
  }

  await createUserAddresses(payload, connection)
}

/**
 * Update user profile in Informix database
 * @param {Object} message the message
 */
async function updateProfile (message) {
  await wrapTransaction(async (connection) => {
    // check if the user exists in the DB
    if (await ensureUserExist(message, connection)) {
      // update user data in common_oltp:user
      await updateUserProfile(message.payload, connection)

      // create code data in informixoltp:coder
      await updateCoderProfile(message.payload, connection)
    }
  })
}

updateProfile.schema = {
  message: Joi.object().keys({
    topic: Joi.string().required(),
    originator: Joi.string().required(),
    timestamp: Joi.date().required(),
    'mime-type': Joi.string().required(),
    payload: Joi.object().keys({
      userId: Joi.number().integer().min(1).required(),
      firstName: Joi.string().allow(''),
      lastName: Joi.string().allow(''),
      email: Joi.string().email().allow(''),
      userHandle: Joi.string().allow(''),
      otherLangName: Joi.string().allow(''),
      description: Joi.string().allow(''),
      homeCountryCode: Joi.string().allow(''),
      competitionCountryCode: Joi.string().allow(''),
      photoURL: Joi.string().allow(''),
      addresses: Joi.array().items(Joi.object({
        type: Joi.string().required(),
        streetAddr1: Joi.string().required(),
        city: Joi.string().required(),
        stateCode: Joi.string().required(),
        zip: Joi.string().required(),
        countryCode: Joi.string().allow(''),
        streetAddr2: Joi.string().allow('')
      }).unknown(true))
    }).unknown(true).required()
  }).required()
}

/**
 * Updates the user basic info in the Informix database.
 * @param {*} data
 * @param {*} connection
 */
async function updateUserBasicInfoTrait (data, connection) {
  if (data.country) {
    // get the country code by country name
    const countryCode = await connection.queryAsync(
      "select country_code code from informixoltp:country where upper(country_name) = upper('" + data.country + "')")
    if (countryCode && countryCode.length > 0) {
      data.countryCode = countryCode[0].code
    }
  }

  // Update the basic info trait in common_oltp:user
  await updateUserProfile(data, connection)

  // Update the basic info trait in informixoltp:coder
  await updateCoderProfile(data, connection)
}

/**
 * Update trait data in Informix database
 * @param {Object} message the message
 */
async function createOrUpdateTrait (message) {
  // check if the message is for basic info trait
  if (_.get(message, 'payload.traitId') !== config.get('BASIC_INFO_TRAIT_ID')) {
    // log the error and ignore the message
    logger.error('The message is not for basic_info trait : ' + message)
    return
  }
  await wrapTransaction(async (connection) => {
    const data = _.get(message, 'payload.traits.data[0]')
    // check if the user exists in the DB
    if (await ensureUserExist(message, connection)) {
      // create or update the user trait
      await updateUserBasicInfoTrait(data, connection)
    }
  })
}

createOrUpdateTrait.schema = {
  message: Joi.object().keys({
    topic: Joi.string().required(),
    originator: Joi.string().required(),
    timestamp: Joi.date().required(),
    'mime-type': Joi.string().required(),
    payload: Joi.object().keys({
      userId: Joi.number().integer().min(1).required(),
      traitId: Joi.string().required(),
      traits: Joi.object().keys({
        traitId: Joi.string(),
        data: Joi.array(Joi.object().keys({
          userId: Joi.number().integer().min(1).required(),
          country: Joi.string().allow(''),
          firstName: Joi.string().allow(''),
          lastName: Joi.string().allow(''),
          addresses: Joi.array().items(Joi.object({
            type: Joi.string().allow(''),
            streetAddr1: Joi.string().allow(''),
            city: Joi.string().allow(''),
            stateCode: Joi.string().allow(''),
            zip: Joi.string().allow(''),
            streetAddr2: Joi.string().allow('')
          })),
        })).length(1).required()
      })
    }).unknown(true).required()
  }).required()
}

/**
 * Update user photo in informix database
 * @param {Object} message the message
 */
async function updatePhoto (message) {
  await wrapTransaction(async (connection) => {
    // check if the user exists in the DB
    if (await ensureUserExist(message, connection)) {
      await updateCoderPhoto(_.get(message, 'payload.userId'), _.get(message, 'payload.photoURL'), connection)
    }
  })
}

updatePhoto.schema = {
  message: Joi.object().keys({
    topic: Joi.string().required(),
    originator: Joi.string().required(),
    timestamp: Joi.date().required(),
    'mime-type': Joi.string().required(),
    payload: Joi.object().keys({
      userId: Joi.number().integer().min(1).required(),
      photoURL: Joi.string().uri().required()
    }).unknown(true).required()
  }).required()
}

/**
 * Gets the user count from the database using the provided connection
 * It is used to check if the user with given id exists in the database.
 *
 * @param {String} userId  The user id to check in the database
 * @param {Object} connection The Informix database connection
 */
async function getUserCountById (userId, connection) {
  return connection.queryAsync('select count(*) count from user where user_id =' + userId)
}

/**
 * Check user with match user id exist in Informix database
 * @param {Object} message the message
 * @param {Object} connection the connection
 */
async function ensureUserExist (message, connection) {
  // check if the user exists in the DB
  const users = await getUserCountById(_.get(message, 'payload.userId'), connection)
  if (Number(users[0].count) === 0) { // The user with match id does not exist
    logger.error('The user with id = ' + _.get(message, 'payload.userId') + ' does not exist')
    return false
  }
  return true
}

/**
 * Gets the user identified by the given handle from Informix database.
 * @param {*} handle The user handle to search for.
 * @param {*} connection The connection to Informix database.
 */
async function getUserByHandle (handle, connection) {
  return connection.queryAsync("select * from user where handle='" + handle + "'")
}

/**
 * Handle the email verification change in Informix database.
 * @param {*} message The message holding the email verification data.
 */
async function verifyEmailChange (message) {
  await wrapTransaction(async (connection) => {
    const userHandle = _.get(message, 'payload.data.userHandle')
    if (!userHandle) {
      logger.error(`user handle is empty`)
      return
    }
    // check if the user exists
    const users = await getUserByHandle(userHandle, connection)

    if (users.length === 0) {
      // The specified handle does not exist
      // log the error and ignore the message
      logger.error(`The user with handle = ${userHandle} does not exist`)
      return
    }
    // update user email.
    await updateUserEmail(users[0].user_id, _.get(message, 'payload.recipients[0]'), connection)
  })
}

verifyEmailChange.schema = {
  message: Joi.object().keys({
    topic: Joi.string().required(),
    originator: Joi.string().required(),
    timestamp: Joi.date().required(),
    'mime-type': Joi.string().required(),
    payload: Joi.object().keys({
      data: Joi.object().keys({
        userHandle: Joi.string().required()
      }).unknown(true).required(),
      recipients: Joi.array().length(1).required()
    }).unknown(true).required()
  }).required()
}

// Exports
module.exports = {
  createProfile,
  updateProfile,
  createOrUpdateTrait,
  updatePhoto,
  verifyEmailChange
}

logger.buildService(module.exports)
