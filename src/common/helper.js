/**
 * Contains generic helper methods
 */

const config = require('config')
const ifxnjs = require('ifxnjs')

/**
 * Get Informix connection using the configured parameters
 * @return {Object} Informix connection
 */
function getInformixConnection () {
  // construct the connection string from the configuration parameters.
  const connectionString = 'SERVER=' + config.get('INFORMIX.SERVER') +
                           ';DATABASE=' + config.get('INFORMIX.DATABASE') +
                           ';HOST=' + config.get('INFORMIX.HOST') +
                           ';Protocol=' + config.get('INFORMIX.PROTOCOL') +
                           ';SERVICE=' + config.get('INFORMIX.PORT') +
                           ';DB_LOCALE=' + config.get('INFORMIX.DB_LOCALE') +
                           ';UID=' + config.get('INFORMIX.USER') +
                           ';PWD=' + config.get('INFORMIX.PASSWORD')

  // return the connection object.
  const connection = ifxnjs.openSync(connectionString)
  return connection
}

module.exports = {
  getInformixConnection
}
