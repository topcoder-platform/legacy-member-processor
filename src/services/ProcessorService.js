/**
 * Service for member legacy processor for updating Informix database.
 */
const _ = require('lodash')
const Joi = require('joi')
const logger = require('../common/logger')
const helper = require('../common/helper')
const config = require('config')

/**
 * Creates the user profile in the database ( in common_oltp:user table)
 * @param {Object} payload The payload holding the user profile information
 * @param {*} connection  The connection object to Informix database
 */
function createUserProfile (payload, connection) {
  // prepare the statement for inserting the user profile data to common_oltp.user table
  const createUserStmt = connection.prepareSync(
    'insert into user (user_id, first_name, last_name, create_date, handle, status, name_in_another_language) ' +
    'values (?,?,?,current,?,?,?)')

  // Execute the statement
  createUserStmt.execute([_.get(payload, 'userId'), _.get(payload, 'firstName', ''),
    _.get(payload, 'lastName', ''), _.get(payload, 'handle', ''),
    _.get(payload, 'status', '') === 'ACTIVE' ? 'A' : 'I',
    _.get(payload, 'otherLangName', '')])

  // create the user email entry in the DB
  const insertEmailStmt = connection.prepareSync(
    'insert into email(user_id, email_id, email_type_id, address, create_date, modify_date, primary_ind, status_id)' +
    ' values(?, sequence_email_seq.nextval, 1, ?, current, current, 1, 1)')

  insertEmailStmt.execute([_.get(payload, 'userId'), _.get(payload, 'email', '')])

  createUserAddressesForProfile(payload, connection)
}

/**
 * Inserts the user data to informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
function createCoderProfile (payload, connection) {
  const createCoderDataStmt = connection.prepareSync(
    'insert into informixoltp:coder(coder_id, member_since, quote, modify_date, home_country_code, ' +
    'comp_country_code,display_quote) values(?, current, ?, current, ?, ?, 1)')

  // Create the coder data
  createCoderDataStmt.execute([_.get(payload, 'userId'), _.get(payload, 'description', ''),
    _.get(payload, 'homeCountryCode', ''), _.get(payload, 'competitionCountryCode', '')])

  if (_.get(payload, 'photoURL') !== undefined) {
    // create the coder image data in the database.
    // get the max image id from the DB
    const imgIdRow = connection.querySync('select max(image_id) max_id from informixoltp:image')
    const imageId = imgIdRow[0].max_id == null ? 1000 : Number(imgIdRow[0].max_id) + 1

    // prepare the statement for image insert
    const insertImgStmt = connection.prepareSync(
      'insert into informixoltp:image(image_id, image_type_id, link, modify_date) values(?, 1, ?, current)')

    // insert the image
    insertImgStmt.execute([imageId, _.get(payload, 'photoURL', '')])

    // associate the image to the coder profile
    const createCoderImgStmt = connection.prepareSync(
      'insert into informixoltp:coder_image_xref(coder_id, image_id, display_flag, modify_date) values(?, ?, 1, current)')
    createCoderImgStmt.execute([_.get(payload, 'userId'), imageId])
  }
}

/**
 * Create user profile in Informix database
 * @param {Object} message the message
 */
function * createProfile (message) {
  const connection = helper.getInformixConnection()

  // create user data in common_oltp:user
  createUserProfile(message.payload, connection)

  // create code data in informixoltp:coder
  createCoderProfile(message.payload, connection)
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
function updateUserEmail (userId, newEmail, connection) {
  const updateEmailQuery = "update email set address = '" + newEmail + "' " +
                           'where user_id = ' + userId + ' and email_type_id = 1 and primary_ind = 1 ' +
                           'and status_id =1'
  connection.querySync(updateEmailQuery)
}

/**
 * Updates the user profile in the database ( in common_oltp:user table)
 * @param {Object} payload The payload holding the user profile information
 * @param {*} connection  The connection object to Informix database
 */
function updateUserProfile (payload, connection) {
  // prepare the query for updating the user in the database
  // as per Topcoder policy, the handle cannot be updated, hence it is removed from updated columns
  const userStatus = _.get(payload, 'status') === 'ACTIVE' ? 'A' : 'I'
  const updateUserQuery = "update user set first_name = '" + _.get(payload, 'firstName', '') + "', " +
                          "last_name = '" + _.get(payload, 'lastName', '') + "', " +
                          "status = '" + userStatus + "', " +
                          "name_in_another_language = '" + _.get(payload, 'otherLangName', '') + "' " +
                          'where user_id = ' + _.get(payload, 'userId')
  connection.querySync(updateUserQuery)

  // update the user email entry in the DB
  updateUserEmail(_.get(payload, 'userId'), _.get(payload, 'email'), connection)

  // cleanup the existing user addresses
  // get and save the ids of the existing user addresses
  const userExistingAddrsIds = connection.querySync(
    'select address_id id from user_address_xref where user_id = ' + _.get(payload, 'userId'))

  // Delete all user addresses references
  const deleteUserAddrsStmt = connection.prepareSync(
    'delete from user_address_xref where user_id = ?')
  deleteUserAddrsStmt.execute([_.get(payload, 'userId')])

  // cleanup the addresses from the address table
  const cleanupAddrsStmt = connection.prepareSync(
    'delete from address where address_id = ?')
  _.each(userExistingAddrsIds, function (addr) {
    cleanupAddrsStmt.execute([addr.id])
  })

  createUserAddressesForProfile(payload, connection)
}

/**
 * Creates the user addresses using the payload data for profile create update
 * @param {Object} payload The profile create/update payload object
 * @param {*} connection The Informix DB connection
 */
function createUserAddressesForProfile (payload, connection) {
  // Insert the new user addresses into the database.
  const insertAddressStmt = connection.prepareSync(
    'insert into address(address_id, address_type_id, address1, address2, city, state_code, zip, create_date, modify_date)' +
    'values(?, ?, ?, ?, ?, ?, ?, current, current)')

  const createUserAddrStmt = connection.prepareSync(
    'insert into user_address_xref(user_id, address_id) values (?,?)')

  // iterate over the user addresses and create them in the db
  _.each(_.get(payload, 'addresses'), function (addr) {
    // Get the address type id from the database.
    const addrTypeRow = connection.querySync('select address_type_id from address_type_lu' +
                                         " where upper(address_type_desc) = '" + addr.type + "'")

    // Get the address sequence next value to be used as address id.
    const addrIdRow = connection.querySync('select first 1 sequence_address_seq.nextval from address')

    // insert the address into db
    insertAddressStmt.execute([addrIdRow[0].nextval, addrTypeRow[0].address_type_id, addr.streetAddr1,
      addr.streetAddr2, addr.city, addr.stateCode, addr.zip])

    // create the relationship between the user and the address
    createUserAddrStmt.execute([_.get(payload, 'userId'), addrIdRow[0].nextval])
  })
}

/**
 * Updates the user data in informixoltp:coder table.
 * @param {Object} payload The payload holding the coder data
 * @param {Object} connection The connection to Informix Database
 */
function updateCoderProfile (payload, connection) {
  const updateCoderQuery = 'update informixoltp:coder ' +
                           "set quote='" + _.get(payload, 'description', '') + "', " +
                           "home_country_code='" + _.get(payload, 'homeCountryCode', '') + "', " +
                           "comp_country_code='" + _.get(payload, 'competitionCountryCode', '') + "', " +
                           'display_quote=1 ' +
                           'where coder_id= ' + _.get(payload, 'userId')

  connection.querySync(updateCoderQuery)

  if (_.get(payload, 'photoURL') !== undefined && _.get(payload, 'photoURL') !== null) {
    updateCoderPhoto(_.get(payload, 'userId'), _.get(payload, 'photoURL'), connection)
  }
}

/**
 * Updates the coder photo in informixoltp:image and informixoltp:coder_image_xref
 * @param {String} coderId The coder id
 * @param {String} photoUrl  The url of the new photo to set for the coder
 */
function updateCoderPhoto (coderId, photoUrl, connection) {
  // get the id of the existing image
  const existingImg = connection.querySync(
    'select image_id id from informixoltp:coder_image_xref where ' +
    'coder_id= ' + coderId + ' and display_flag=1'
  )

  if (existingImg.length === 0) { // The coder does not have an existing image, we insert a new one
    // create the coder image data in the database.
    // get the max image id from the DB
    const imgIdRow = connection.querySync('select max(image_id) max_id from informixoltp:image')
    const imageId = imgIdRow[0].max_id == null ? 1000 : Number(imgIdRow[0].max_id) + 1

    // prepare the statement for image insert
    const insertImgStmt = connection.prepareSync(
      'insert into informixoltp:image(image_id, image_type_id, link, modify_date) values(?, 1, ?, current)')

    // insert the image
    insertImgStmt.execute([imageId, photoUrl])

    // associate the image to the coder profile
    const createCoderImgStmt = connection.prepareSync(
      'insert into informixoltp:coder_image_xref(coder_id, image_id, display_flag, modify_date) ' +
      'values(?, ?, 1, current)')
    createCoderImgStmt.execute([coderId, imageId])
  } else { // The coder already have an existing image, we only update the image link
    connection.querySync("update informixoltp:image set link='" + photoUrl + "' " +
                         'where image_id=' + existingImg[0].id)
  }
}

/**
 * Updates the user addresses in the Informix database
 * @param {Object} payload The payload containing the addresses data
 * @param {Object} connection The informix connection object
 * @param {String} countryCode The country code for the addresses
 */
function updateUserAddresses (payload, connection, countryCode) {
  // cleanup the existing user addresses
  // get and save the ids of the existing user addresses
  const userExistingAddrsIds = connection.querySync(
    'select address_id id from user_address_xref where user_id = ' + _.get(payload, 'userId'))

  // Delete all user addresses references
  const deleteUserAddrsStmt = connection.prepareSync(
    'delete from user_address_xref where user_id = ?')
  deleteUserAddrsStmt.execute([_.get(payload, 'userId')])

  // cleanup the addresses from the address table
  const cleanupAddrsStmt = connection.prepareSync(
    'delete from address where address_id = ?')
  _.each(userExistingAddrsIds, function (addr) {
    cleanupAddrsStmt.execute([addr.id])
  })

  const createUserAddrStmt = connection.prepareSync(
    'insert into user_address_xref(user_id, address_id) values (?,?)')

  // iterate over the user addresses and create them in the db
  _.each(_.get(payload, 'addresses'), function (addr) {
    // Get the address type id from the database.
    const addrTypeRow = connection.querySync('select address_type_id from address_type_lu' +
                                         " where upper(address_type_desc) = '" + addr.type + "'")

    // Get the address sequence next value to be used as address id.
    const addrIdRow = connection.querySync('select first 1 sequence_address_seq.nextval from address')

    // insert the address into db
    if (countryCode) {
      let insertAddressQuery = 'insert into address(address_id, address_type_id, address1, address2, city, ' +
                               'zip, country_code, create_date, modify_date) ' +
                               'values(' + addrIdRow[0].nextval + ',' + addrTypeRow[0].address_type_id + ',' +
                               "'" + addr.streetAddr1 + "','" + addr.streetAddr2 + "','" + addr.city + "'," +
                               "'" + addr.zip + "','" + countryCode + "',current, current)"
      connection.querySync(insertAddressQuery)
    } else {
      let insertAddressQuery = 'insert into address(address_id, address_type_id, address1, address2, city, ' +
                               'zip, create_date, modify_date) ' +
                               'values(' + addrIdRow[0].nextval + ',' + addrTypeRow[0].address_type_id + ',' +
                               "'" + addr.streetAddr1 + "','" + addr.streetAddr2 + "','" + addr.city + "'," +
                               "'" + addr.zip + "',current, current)"

      connection.querySync(insertAddressQuery)
    }
    // create the relationship between the user and the address
    createUserAddrStmt.execute([_.get(payload, 'userId'), addrIdRow[0].nextval])
  })
}

/**
 * Update user profile in Informix database
 * @param {Object} message the message
 */
function * updateProfile (message) {
  const connection = helper.getInformixConnection()

  // check if the user exists in the DB
  const user = connection.querySync(
    'select count(*) count from user where user_id =' + _.get(message, 'payload.userId'))

  if (user[0].count === 0) { // The user to be updated does not exist
    logger.error('The user with id = ' + _.get(message, 'payload.userId') + ' does not exist')
    return
  }

  // update user data in common_oltp:user
  updateUserProfile(message.payload, connection)

  // create code data in informixoltp:coder
  updateCoderProfile(message.payload, connection)
}

updateProfile.schema = createProfile.schema

/**
 * Updates the user basic info in the Informix database.
 * @param {*} data
 * @param {*} connection
 */
function updateUserBasicInfoTrait (data, connection) {
  const status = _.get(data, 'status') === 'ACTIVE' ? 'A' : 'I'

  const updateUserQuery = 'update user set ' +
                          "first_name = '" + data.firstName + "', " +
                          "last_name = '" + data.lastName + "', " +
                          "status = '" + status + "' " +
                          'where user_id = ' + _.get(data, 'userId')
  // Execute the update user query
  connection.querySync(updateUserQuery)

  // update the user email entry in the DB
  updateUserEmail(_.get(data, 'userId'), _.get(data, 'email'), connection)

  // Update the basic info trait in informixoltp database
  updateCoderProfile(data, connection)

  // get the country code by country name
  const countryCode = connection.querySync(
    "select country_code code from informixoltp:country where upper(country_name) = upper('" + data.country + "')")

  if (countryCode !== undefined && countryCode !== null && countryCode.length > 0) {
    console.log()
    updateUserAddresses(data, connection, countryCode[0].code)
  } else { // update the addresses without setting the country code
    updateUserAddresses(data, connection)
  }
}

/**
 * Create or updates trait data in Informix database
 * @param {Object} message the message
 */
function * createOrUpdateTrait (message) {
  // check if the message is for basic info trait
  if (_.get(message, 'payload.traitId') !== config.get('BASIC_INFO_TRAIT_ID')) {
    // log the error and ignore the message
    logger.error('The message is not for basic_info trait : ' + message)
    return
  }

  const connection = helper.getInformixConnection()

  // check if the user exists
  const users = getUserCountById(_.get(message, 'payload.userId'), connection)

  if (users[0].count === 0) {
    // The user does not exist
    // log the error and ignore the message
    logger.error('The user with id = ' + _.get(message, 'payload.userId') + ' does not exist')
    return
  }

  // create the user trait
  updateUserBasicInfoTrait(_.get(message, 'payload.traits.data[0]'), connection)
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
function * updatePhoto (message) {
  const connection = helper.getInformixConnection()

  // check if the user exists
  // check if the user exists in the DB
  const users = getUserCountById(_.get(message, 'payload.userId'), connection)

  if (users[0].count === 0) {
    // The user does not exist
    // log the error and ignore the message
    logger.error('The user with id = ' + _.get(message, 'payload.userId') + ' does not exist')
    return
  }
  updateCoderPhoto(_.get(message, 'payload.userId'), _.get(message, 'payload.photoURL'), connection)
}

/**
 * Gets the user count from the database using the provided connection
 * It is used to check if the user with given id exists in the database.
 *
 * @param {String} userId  The user id to check in the database
 * @param {Object} connection The Informix database connection
 */
function getUserCountById (userId, connection) {
  return connection.querySync('select count(*) count from user where user_id =' + userId)
}

/**
 * Gets the user identified by the given handle from Informix database.
 * @param {*} handle The user handle to search for.
 * @param {*} connection The connection to Informix database.
 */
function getUserByHandle (handle, connection) {
  return connection.querySync("select * from user where handle='" + handle + "'")
}

/**
 * Handle the email verification change in Informix database.
 * @param {*} message The message holding the email verification data.
 */
function * verifyEmailChange (message) {
  const connection = helper.getInformixConnection()

  // check if the user exists
  const users = getUserByHandle(_.get(message, 'payload.data.userHandle'), connection)

  if (users.length === 0) {
    // The specified handle does not exist
    // log the error and ignore the message
    logger.error('The user with handle = ' + _.get(message, 'payload.data.userHandle') + ' does not exist')
    return
  }

  // update user email.
  updateUserEmail(users[0].user_id, _.get(message, 'payload.recipients[0]'), connection)
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
