/**
 * The default configuration file.
 */

module.exports = {
  DISABLE_LOGGING: false, // If true, logging will be disabled
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',

  KAFKA_URL: process.env.KAFKA_URL,

  KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID || 'tc-legacy-member-processor-group',

  // below are used for secure Kafka connection, they are optional
  // for the local Kafka, they are not needed
  KAFKA_CLIENT_CERT: process.env.KAFKA_CLIENT_CERT,
  KAFKA_CLIENT_CERT_KEY: process.env.KAFKA_CLIENT_CERT_KEY,

  CREATE_PROFILE_TOPIC: process.env.CREATE_PROFILE_TOPIC || 'member.action.profile.create',
  UPDATE_PROFILE_TOPIC: process.env.UPDATE_PROFILE_TOPIC || 'member.action.profile.update',
  //CREATE_TRAIT_TOPIC: process.env.CREATE_TRAIT_TOPIC || 'member.action.profile.trait.create',
  //UPDATE_TRAIT_TOPIC: process.env.UPDATE_TRAIT_TOPIC || 'member.action.profile.trait.update',
  UPDATE_PHOTO_TOPIC: process.env.UPDATE_PHOTO_TOPIC || 'member.action.profile.photo.update',
  EMAIL_CHANGE_VERIFICATION_TOPIC: process.env.EMAIL_CHANGE_VERIFICATION_TOPIC || 'member.action.email.profile.emailchange.verification',

  // informix database configuration
  INFORMIX: {
    SERVER: process.env.IFX_SERVER || 'informixoltp_tcp',
    DATABASE: process.env.IFX_DATABASE || 'common_oltp',
    HOST: process.env.INFORMIX_HOST || 'localhost',
    PROTOCOL: process.env.IFX_PROTOCOL || 'onsoctcp',
    PORT: process.env.IFX_PORT || '2021',
    DB_LOCALE: process.env.IFX_DB_LOCALE || 'en_US.utf8',
    USER: process.env.IFX_USER || 'informix',
    PASSWORD: process.env.IFX_PASSWORD || '1nf0rm1x',
    POOL_MAX_SIZE: parseInt(process.env.IFX_POOL_MAX_SIZE || '10')
  },

  // The id of the basic info trait
  BASIC_INFO_TRAIT_ID: process.env.BASIC_INFO_TRAIT_ID || 'basic_info'
}
