/**
 * Configuration file to be used while running tests
 */

module.exports = {
  DISABLE_LOGGING: true, // If true, logging will be disabled
  LOG_LEVEL: 'debug',
  // use fixed topic/property name to avoid tests will be broken for different values
  CREATE_PROFILE_TOPIC: 'member.action.profile.create',
  UPDATE_PROFILE_TOPIC: 'member.action.profile.update',
  CREATE_TRAIT_TOPIC: 'member.action.profile.trait.create',
  UPDATE_TRAIT_TOPIC: 'member.action.profile.trait.update',
  UPDATE_PHOTO_TOPIC: 'member.action.profile.photo.update',
  EMAIL_CHANGE_VERIFICATION_TOPIC: 'member.action.email.profile.emailchange.verification',
  BASIC_INFO_TRAIT_ID: 'basic_info',
  WAIT_TIME: 1000 // small wait time used in test
}
