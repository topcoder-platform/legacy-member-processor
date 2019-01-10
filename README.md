# Topcoder - Member Legacy Processor 

## Dependencies

- nodejs https://nodejs.org/en/ (v8+)
- Kafka
- Informix
- Docker, Docker Compose

## Configuration

Configuration for the member legacy processor is at `config/default.js`.
The following parameters can be set in config files or in env variables:
- DISABLE_LOGGING: whether to disable logging
- LOG_LEVEL: the log level; default value: 'debug'
- KAFKA_URL: comma separated Kafka hosts; default value: 'localhost:9092'
- KAFKA_GROUP_ID: consumer group id; default value: 'tc-legacy-member-processor-group'
- KAFKA_CLIENT_CERT: Kafka connection certificate, optional; default value is undefined;
    if not provided, then SSL connection is not used, direct insecure connection is used;
    if provided, it can be either path to certificate file or certificate content
- KAFKA_CLIENT_CERT_KEY: Kafka connection private key, optional; default value is undefined;
    if not provided, then SSL connection is not used, direct insecure connection is used;
    if provided, it can be either path to private key file or private key content
- CREATE_PROFILE_TOPIC: create profile Kafka topic, default value is 'member.action.profile.create'
- UPDATE_PROFILE_TOPIC: update profile Kafka topic, default value is 'member.action.profile.update'
- CREATE_TRAIT_TOPIC: create trait Kafka topic, default value is 'member.action.profile.trait.create'
- UPDATE_TRAIT_TOPIC: update trait Kafka topic, default value is 'member.action.profile.trait.update'
- UPDATE_PHOTO_TOPIC: update photo Kafka topic, default value is 'member.action.profile.photo.update'
- EMAIL_CHANGE_VERIFICATION_TOPIC : email change verification topic, default value is 'member.action.email.profile.emailchange.verification'
- INFORMIX: Informix configuration parameters ( generally, we only need to update INFORMIX_HOST via environment variables, see INFORMIX_HOST parameter in docker/api.env)

Also note that there is a `/health` endpoint that checks for the health of the app. This sets up an expressjs server and listens on the environment variable `PORT`. It's not part of the configuration file and needs to be passed as an environment variable

Configuration for the tests is at `config/test.js`, only add such new configurations different from `config/default.js` 
- WAIT_TIME: wait time used in test, default is 1000 or one second

## Local Kafka setup

- `http://kafka.apache.org/quickstart` contains details to setup and manage Kafka server,
  below provides details to setup Kafka server in Linux/Mac, Windows will use bat commands in bin/windows instead
- download kafka at `https://www.apache.org/dyn/closer.cgi?path=/kafka/1.1.0/kafka_2.11-1.1.0.tgz`
- extract out the downloaded tgz file
- go to extracted directory kafka_2.11-0.11.0.1
- start ZooKeeper server:
  `bin/zookeeper-server-start.sh config/zookeeper.properties`
- use another terminal, go to same directory, start the Kafka server:
  `bin/kafka-server-start.sh config/server.properties`
- note that the zookeeper server is at localhost:2181, and Kafka server is at localhost:9092
- use another terminal, go to same directory, create the needed topics:
  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.profile.create`

  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.profile.update`

  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.profile.photo.update`

  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.email.profile.emailchange.verification`

  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.profile.trait.create`

  `bin/kafka-topics.sh --create --zookeeper localhost:2181 --replication-factor 1 --partitions 1 --topic member.action.profile.trait.update`

- verify that the topics are created:
  `bin/kafka-topics.sh --list --zookeeper localhost:2181`,
  it should list out the created topics
- run the producer and then write some message into the console to send to the `member.action.profile.create` topic:
  `bin/kafka-console-producer.sh --broker-list localhost:9092 --topic member.action.profile.create`
  in the console, write message, one message per line:
  `{ "topic": "member.action.profile.create", "originator": "member-api", "timestamp": "2018-02-16T00:00:00", "mime-type": "application/json", "payload": { "userId": 1111, "userHandle": "handle", "email": "email@test.com", "sex": "male", "created": "2018-01-02T00:00:00", "createdBy": "admin" } }`
- optionally, use another terminal, go to same directory, start a consumer to view the messages:
  `bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic member.action.profile.create --from-beginning`
- writing/reading messages to/from other topics are similar


## Topcoder Informix Database Setup
We will use Topcoder Informix database setup on Docker.

Go to docker-ifx folder, run `docker-compose up`

Once Informix database is properly started, connect to it and execute the following statement in common_oltp database :

`CREATE SEQUENCE sequence_address_seq INCREMENT BY 1 START WITH 3000000 MINVALUE 3000000;`

This sequence is used by the source code to generate the ids of the addresses to be inserted in the database.



## Local deployment
- Given the fact that the library used to access Informix DB depends on Informix Client SDK.
We will run the application on Docker using a base image with Informix Client SDK installed and properly configured.
For deployment, please refer to next section 'Local Deployment with Docker'

## Local Deployment with Docker

To run the Member Legacy Processor using docker, follow the steps below

1. Make sure that Kafka and Informix are running as per instructions above.

2. Navigate to the directory `docker`

3. Rename the file `sample.api.env` to `api.env` And properly update the IP addresses to match your environment for the variables : KAFKA_URL_DEV and INFORMIX_HOST ( make sure to use IP address instead of hostname ( i.e localhost will not work)).

4. Once that is done, run the following command

```
docker-compose up
```

5. When you are running the application for the first time, It will take some time initially to download the image and install the dependencies


## Running unit tests and coverage
You need to run `docker-compose build` if modify source files.
Make sure run `docker-compose up` in `docker` folder once to make sure application will install dependencies and run successfully with Kafka and Informix.

To run unit tests alone
Modify `docker/docker-compose.yml` with `entrypoint: npm run test` and run `docker-compose up` in `docker` folder

To run unit tests with coverage report

Modify `docker/docker-compose.yml` with `entrypoint: npm run cov` and run `docker-compose up` in `docker` folder

## Running integration tests and coverage

To run integration tests alone

Modify `docker/docker-compose.yml` with `entrypoint: npm run e2e` and run `docker-compose up` in `docker` folder


To run integration tests with coverage report

Modify `docker/docker-compose.yml` with `entrypoint: npm run cov-e2e` and run `docker-compose up` in `docker` folder

## Verification
Refer to the verification document under legacy-member-processor/docs/verification.docx


### Verification for Topcoder - Legacy member processor updates
1. unit and e2e tests
see above unit and e2e tests commands.

2. BUG FIX
Change to use async/await instead of co, update version of `no-kafka` to latest version in `package.json` to solve this issue.
Make sure there are no other consumers listening topics and have clean kafka server to test with.
Make processor up, make sure it could process messages successfully, then make processor down, still send messages, later make processor up again and you will see processor could still process messages sent during processor is down.
Please note if you send invalid json messages it will still process such invalid json messages during start up of processor and previous application codes did not work properly to reprocess such error messages.
You may have to manually commit such error messages or rerun e2e tests to make sure all error messages will be processed.