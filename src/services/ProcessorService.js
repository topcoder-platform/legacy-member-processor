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
const getStatus = (payload) => _.get(payload, 'status', '') === 'ACTIVE' ? 'A' : 'I'

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
  if (!payload.handle) throw new Error('handle is required!')
  // prepare the statement for inserting the user profile data to common_oltp.user table
  const createUserStmt = await prepare(connection,
    'insert into user (user_id, first_name, last_name, create_date, handle, status, name_in_another_language) ' +
    'values (?,?,?,current,?,?,?)')

  // Execute the statement
  await createUserStmt.executeAsync([_.get(payload, 'userId'), _.get(payload, 'firstName'),
    _.get(payload, 'lastName'), _.get(payload, 'handle', ''),
    getStatus(payload),
    _.get(payload, 'otherLangName', '')])

  // create the user email entry in the DB
  const insertEmailStmt = await prepare(connection,
    'insert into email(user_id, email_id, email_type_id, address, create_date, modify_date, primary_ind, status_id)' +
    ' values(?, sequence_email_seq.nextval, 1, ?, current, current, 1, 1)')

  await insertEmailStmt.executeAsync([_.get(payload, 'userId'), _.get(payload, 'email', '')])

  await createUserAddressesForProfile(payload, connection)
}

createUserProfile.schema = {
  payload: Joi.object().keys({
    userId: Joi.number().required(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    email: Joi.string().email().required(),
    handle: Joi.string(),
    otherLangName: Joi.string()
  }).unknown().required(),
  connection: Joi.any()
}

/**
 * Inserts the user data to informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
async function createCoderProfile (payload, connection) {
  const createCoderDataStmt = await prepare(connection,
    'insert into informixoltp:coder(coder_id, member_since, quote, modify_date, home_country_code, ' +
    'comp_country_code,display_quote) values(?, current, ?, current, ?, ?, 1)')

  // Create the coder data
  await createCoderDataStmt.executeAsync([_.get(payload, 'userId'), _.get(payload, 'description', ''),
    _.get(payload, 'homeCountryCode', ''), _.get(payload, 'competitionCountryCode', '')])

  if (_.get(payload, 'photoURL')) {
    await createCoderImage(_.get(payload, 'userId'), _.get(payload, 'photoURL'), connection)
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
      userId: Joi.number().integer().min(1).required()
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
  // prepare the query for updating the user in the database
  // as per Topcoder policy, the handle cannot be updated, hence it is removed from updated columns
  const userStatus = getStatus(payload)
  const updateUserQuery = "update user set first_name = '" + _.get(payload, 'firstName') + "', " +
                          "last_name = '" + _.get(payload, 'lastName') + "', " +
                          "status = '" + userStatus + "', " +
                          "name_in_another_language = '" + _.get(payload, 'otherLangName') + "' " +
                          'where user_id = ' + _.get(payload, 'userId')
  await connection.queryAsync(updateUserQuery)

  // update the user email entry in the DB
  await updateUserEmail(_.get(payload, 'userId'), _.get(payload, 'email'), connection)

  // cleanup the existing user addresses
  // get and save the ids of the existing user addresses
  const userExistingAddrsIds = await connection.queryAsync(
    'select address_id id from user_address_xref where user_id = ' + _.get(payload, 'userId'))

  // Delete all user addresses references
  const deleteUserAddrsStmt = await prepare(connection,
    'delete from user_address_xref where user_id = ?')
  await deleteUserAddrsStmt.executeAsync([_.get(payload, 'userId')])

  // cleanup the addresses from the address table
  const cleanupAddrsStmt = await prepare(connection,
    'delete from address where address_id = ?')
  for (let addr of userExistingAddrsIds) {
    await cleanupAddrsStmt.executeAsync([addr.id])
  }
  await createUserAddressesForProfile(payload, connection)
}

updateUserProfile.schema = createUserProfile.schema

/**
 * Creates the user addresses using the payload data for profile create update
 * @param {Object} payload The profile create/update payload object
 * @param {*} connection The Informix DB connection
 */
async function createUserAddressesForProfile (payload, connection) {
  // Insert the new user addresses into the database.
  const insertAddressStmt = await prepare(connection,
    'insert into address(address_id, address_type_id, address1, address2, city, state_code, zip, create_date, modify_date)' +
    'values(?, ?, ?, ?, ?, ?, ?, current, current)')

  const createUserAddrStmt = await prepare(connection,
    'insert into user_address_xref(user_id, address_id) values (?,?)')

  // iterate over the user addresses and create them in the db
  for (let addr of _.get(payload, 'addresses', [])) {
    // Get the address type id from the database.
    const addrTypeRow = await connection.queryAsync('select address_type_id from address_type_lu' +
      " where upper(address_type_desc) = '" + addr.type + "'")

    // Get the address sequence next value to be used as address id.
    const addrIdRow = await connection.queryAsync('select first 1 sequence_address_seq.nextval from address')

    // insert the address into db
    await insertAddressStmt.executeAsync([addrIdRow[0].nextval, addrTypeRow[0].address_type_id, addr.streetAddr1,
      addr.streetAddr2, addr.city, addr.stateCode, addr.zip])

    // create the relationship between the user and the address
    await createUserAddrStmt.executeAsync([_.get(payload, 'userId'), addrIdRow[0].nextval])
  }
}

/**
 * Updates the user data in informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
async function updateCoderProfile (payload, connection) {
  const updateCoderQuery = 'update informixoltp:coder ' +
                           "set quote='" + _.get(payload, 'description', '') + "', " +
                           "home_country_code='" + _.get(payload, 'homeCountryCode', '') + "', " +
                           "comp_country_code='" + _.get(payload, 'competitionCountryCode', '') + "', " +
                           'display_quote=1 ' +
                           'where coder_id= ' + _.get(payload, 'userId')

  await connection.queryAsync(updateCoderQuery)

  if (_.get(payload, 'photoURL')) {
    await updateCoderPhoto(_.get(payload, 'userId'), _.get(payload, 'photoURL'), connection)
  }
}

/**
 * Updates the coder photo in informixoltp:image and informixoltp:coder_image_xref
 * @param {String} coderId The coder id
 * @param {String} photoUrl  The url of the new photo to set for the coder
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
 * @param {String} countryCode The country code for the addresses
 */
async function updateUserAddresses (payload, connection, countryCode) {
  // cleanup the existing user addresses
  // get and save the ids of the existing user addresses
  const userExistingAddrsIds = await connection.queryAsync(
    'select address_id id from user_address_xref where user_id = ' + _.get(payload, 'userId'))

  // Delete all user addresses references
  const deleteUserAddrsStmt = await prepare(connection,
    'delete from user_address_xref where user_id = ?')
  deleteUserAddrsStmt.execute([_.get(payload, 'userId')])

  // cleanup the addresses from the address table
  const cleanupAddrsStmt = await prepare(connection,
    'delete from address where address_id = ?')
  for (let addr of userExistingAddrsIds) {
    await cleanupAddrsStmt.executeAsync([addr.id])
  }

  const createUserAddrStmt = await prepare(connection,
    'insert into user_address_xref(user_id, address_id) values (?,?)')
  // iterate over the user addresses and create them in the db
  for (let addr of _.get(payload, 'addresses', [])) {
    // Get the address type id from the database.
    const addrTypeRow = await connection.queryAsync(`select address_type_id from address_type_lu where upper(address_type_desc) = '${addr.type}'`)

    // Get the address sequence next value to be used as address id.
    const addrIdRow = await connection.queryAsync('select first 1 sequence_address_seq.nextval from address')

    // insert the address into db
    if (countryCode) {
      let insertAddressQuery = 'insert into address(address_id, address_type_id, address1, address2, city, ' +
        'zip, country_code, create_date, modify_date) ' +
        'values(' + addrIdRow[0].nextval + ',' + addrTypeRow[0].address_type_id + ',' +
        "'" + addr.streetAddr1 + "','" + addr.streetAddr2 + "','" + addr.city + "'," +
        "'" + addr.zip + "','" + countryCode + "',current, current)"
      await connection.queryAsync(insertAddressQuery)
    } else {
      let insertAddressQuery = 'insert into address(address_id, address_type_id, address1, address2, city, ' +
        'zip, create_date, modify_date) ' +
        'values(' + addrIdRow[0].nextval + ',' + addrTypeRow[0].address_type_id + ',' +
        "'" + addr.streetAddr1 + "','" + addr.streetAddr2 + "','" + addr.city + "'," +
        "'" + addr.zip + "',current, current)"

      await connection.queryAsync(insertAddressQuery)
    }
    // create the relationship between the user and the address
    await createUserAddrStmt.executeAsync([_.get(payload, 'userId'), addrIdRow[0].nextval])
  }
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

updateProfile.schema = createProfile.schema

/**
 * Updates the user basic info in the Informix database.
 * @param {*} data
 * @param {*} connection
 */
async function updateUserBasicInfoTrait (data, connection) {
  const status = getStatus(data)

  const updateUserQuery = 'update user set ' +
                          data.firstName ? "first_name = '" + data.firstName + "', " : '' +
                          data.lastName ? "last_name = '" + data.lastName + "', " : '' +
                          "status = '" + status + "' " +
                          'where user_id = ' + _.get(data, 'userId')
  // Execute the update user query
  await connection.queryAsync(updateUserQuery)

  // update the user email entry in the DB
  await updateUserEmail(_.get(data, 'userId'), _.get(data, 'email'), connection)

  // Update the basic info trait in informixoltp database
  await updateCoderProfile(data, connection)

  // get the country code by country name
  const countryCode = await connection.queryAsync(
    "select country_code code from informixoltp:country where upper(country_name) = upper('" + data.country + "')")

  if (countryCode && countryCode.length > 0) {
    await updateUserAddresses(data, connection, countryCode[0].code)
  } else { // update the addresses without setting the country code
    await updateUserAddresses(data, connection)
  }
}

/**
 * Create or updates trait data in Informix database
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
    // check if the user exists in the DB
    if (await ensureUserExist(message, connection)) {
      // create or update the user trait
      await updateUserBasicInfoTrait(_.get(message, 'payload.traits.data[0]'), connection)
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
        data: Joi.array().length(1).required()
      })
    }).unknown(true).required()
  }).required()
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
