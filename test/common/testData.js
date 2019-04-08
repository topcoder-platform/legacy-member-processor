/*
 * Test data to be used in tests
 */
const path = require('path')
const fs = require('fs')
const prepareSql = fs.readFileSync(path.join(__dirname, '../test_files/prepare.sql'), 'utf-8')
const createProfileMessage = require('../../docs/sample-messages/create-profile')
const updateProfileMessage = require('../../docs/sample-messages/update-profile')
const createTraitMessage = require('../../docs/sample-messages/create-trait.json')
const updateTraitMessage = require('../../docs/sample-messages/update-trait.json')
const updatePhotoMessage = require('../../docs/sample-messages/update-photo.json')
const verifyEmailChangeMessage = require('../../docs/sample-messages/email-change-verification.json')
const verifyEmailChangeInvalidHandleMessage = require('../../docs/sample-messages/email-change-verification-invalid-handle.json')
const messageRequiredFields = ['topic', 'originator', 'timestamp', 'mime-type', 'payload']
const stringFields = ['topic', 'originator', 'mime-type']
const testMethods = {
  'createProfile': {
    requiredFields: [...messageRequiredFields, 'payload.userId'],
    integerFields: ['payload.userId'],
    stringFields,
    testMessage: createProfileMessage
  },
  'updateProfile': {
    requiredFields: [...messageRequiredFields, 'payload.userId'],
    integerFields: ['payload.userId'],
    stringFields,
    testMessage: updateProfileMessage
  },
  /*
  'createOrUpdateTrait': {
    requiredFields: [...messageRequiredFields, 'payload.userId', 'payload.traitId', 'payload.traits.data'],
    integerFields: ['payload.userId'],
    stringFields: [...stringFields, 'payload.traitId'],
    arrayFields: ['payload.traits.data'],
    testMessage: createTraitMessage
  },
  */
  'updatePhoto': {
    requiredFields: [...messageRequiredFields, 'payload.userId', 'payload.photoURL'],
    integerFields: ['payload.userId'],
    stringFields: [...stringFields, 'payload.photoURL'],
    urlFields: ['payload.photoURL'],
    testMessage: updatePhotoMessage
  },
  'verifyEmailChange': {
    requiredFields: [...messageRequiredFields, 'payload.data.userHandle', 'payload.recipients'],
    stringFields: [...stringFields, 'payload.data.userHandle'],
    arrayFields: ['payload.recipients'],
    testMessage: verifyEmailChangeMessage
  }
}

module.exports = {
  prepareSql,
  testMethods,
  createProfileMessage,
  updateTraitMessage,
  verifyEmailChangeInvalidHandleMessage
}
