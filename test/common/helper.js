/**
 * This module provides test helper functionality.
 */
const should = require('should')
const _ = require('lodash')
const { getInformixConnection, prepare, wrapTransaction } = require('../../src/common/helper')

/**
 * Sleep with given time
 * @param time the time to sleep
 */
async function sleep (time) {
  await new Promise((resolve) => {
    setTimeout(resolve, time)
  })
}

/**
 * Expect count of match table rows with params
 * @param table the table
 * @param count the rows to expect
 * @param params the sql params
 */
async function expectTable (table, count, params) {
  let tableParams = params || {}
  const values = []
  let sql = `select count(*)::int as count from ${table}`
  if (!_.isEmpty(tableParams)) {
    sql += ` where ${Object.keys(tableParams).map((k) => {
      const v = tableParams[k]
      if (_.isNull(v)) {
        return `${k} is null`
      } else {
        values.push(v)
        return `${k}=?`
      }
    }).join(' and ')}`
  }
  const connection = await getInformixConnection()
  const queryStmt = await prepare(connection, sql)
  const queryResult = Promise.promisifyAll((await queryStmt.executeAsync(values)))
  const result = await queryResult.fetchAllAsync()
  const countResult = result[0].count
  await connection.closeAsync()
  should.equal(countResult, count, `Table ${table} got wrong expect count result expect ${count} actual ${countResult}`)
}

/**
 * Execute sql
 * @param sql the sql
 */
async function runSql (sql) {
  await wrapTransaction(async (conn) => {
    await conn.queryAsync(sql)
  })
}

/**
 * Assert error logs for error message
 * @param errorLogs the error logs
 * @param message the error message to validate
 */
const assertErrorLogs = (errorLogs, message) => {
  errorLogs.should.not.be.empty()
  errorLogs.some(x => String(x).includes(message)).should.be.true()
}

module.exports = {
  sleep,
  runSql,
  expectTable,
  assertErrorLogs
}
