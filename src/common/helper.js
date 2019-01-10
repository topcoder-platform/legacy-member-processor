/**
 * Contains generic helper methods
 */

const config = require('config')
const ifxnjs = require('ifxnjs')
const Pool = ifxnjs.Pool
const pool = Promise.promisifyAll(new Pool())
pool.setMaxPoolSize(config.get('INFORMIX.POOL_MAX_SIZE'))
/**
 * Get Informix connection using the configured parameters
 * @return {Object} Informix connection
 */
async function getInformixConnection () {
  // construct the connection string from the configuration parameters.
  const connectionString = 'SERVER=' + config.get('INFORMIX.SERVER') +
                           ';DATABASE=' + config.get('INFORMIX.DATABASE') +
                           ';HOST=' + config.get('INFORMIX.HOST') +
                           ';Protocol=' + config.get('INFORMIX.PROTOCOL') +
                           ';SERVICE=' + config.get('INFORMIX.PORT') +
                           ';DB_LOCALE=' + config.get('INFORMIX.DB_LOCALE') +
                           ';UID=' + config.get('INFORMIX.USER') +
                           ';PWD=' + config.get('INFORMIX.PASSWORD')
  const conn = await pool.openAsync(connectionString)
  return Promise.promisifyAll(conn)
}

/**
 * Get Kafka options from configuration file.
 * @return Kafka options from configuration file.
 */
function getKafkaOptions () {
  const options = { connectionString: config.KAFKA_URL, groupId: config.KAFKA_GROUP_ID }
  if (config.KAFKA_CLIENT_CERT && config.KAFKA_CLIENT_CERT_KEY) {
    options.ssl = { cert: config.KAFKA_CLIENT_CERT, key: config.KAFKA_CLIENT_CERT_KEY }
  }
  return options
}

/**
 * Prepare Informix statement
 * @param connection the Informix connection
 * @param sql the sql
 * @return {Object} Informix statement
 */
async function prepare (connection, sql) {
  const stmt = await connection.prepareAsync(sql)
  return Promise.promisifyAll(stmt)
}

/**
 * Wrap Informix queries with transaction support
 * @param func the Informix multi queries with write operations
 */
async function wrapTransaction (func) {
  const conn = await getInformixConnection()
  try {
    await conn.beginTransactionAsync()
    const result = await func(conn)
    await conn.commitTransactionAsync()
    return result
  } catch (e) {
    await conn.rollbackTransactionAsync()
    throw e
  } finally {
    await conn.closeAsync()
  }
}

module.exports = {
  getInformixConnection,
  prepare,
  wrapTransaction,
  getKafkaOptions
}
