FROM appiriodevops/tc-database-scripts:base

ARG servername=informix

USER root
WORKDIR /home/informix
RUN sed -i '/jessie-updates/d' /etc/apt/sources.list
RUN sed -i 's|security.debian.org|archive.debian.org/debian-security|' /etc/apt/sources.list
RUN sed -i 's/httpredir.debian/archive.debian/' /etc/apt/sources.list
RUN apt-get -qq update && apt-get -qq install -y --force-yes \
   wget gcc g++ make xz-utils python2.7 git curl

RUN wget -q -O node8.tar.xz https://nodejs.org/dist/v8.11.3/node-v8.11.3-linux-x64.tar.xz \
   && tar xfJ node8.tar.xz && rm -rf node8.tar.xz

ENV SERVERNAME=$servername
ENV INFORMIXDIR /opt/IBM/informix
ENV INFORMIX_HOME /home/informix
ENV INFORMIXSERVER informixoltp_tcp
ENV INFORMIXTERM terminfo
ENV CLIENT_LOCALE=en_US.utf8
ENV DB_LOCALE=en_US.utf8
ENV DBDATE Y4MD-
ENV DBDELIMITER "|"

COPY docker/esql ${INFORMIXDIR}/bin/

RUN chmod +x ${INFORMIXDIR}/bin/esql
RUN echo "informixoltp_tcp        onsoctcp        ${SERVERNAME:-informix}               sqlexec" \
  > ${INFORMIXDIR}/etc/sqlhosts.informixoltp_tcp


ENV PATH /home/informix/node-v8.11.3-linux-x64/bin:${INFORMIXDIR}/bin:${INFORMIXDIR}/lib:${INFORMIXDIR}/lib/esql:${PATH}
ENV LD_LIBRARY_PATH ${INFORMIXDIR}/lib:${INFORMIXDIR}/lib/esql:${INFORMIXDIR}/lib/cli
ENV INFORMIXSQLHOSTS ${INFORMIXDIR}/etc/sqlhosts.informixoltp_tcp
ENV USER root
ENV LICENSE accept

RUN rm /usr/bin/python && ln -s /usr/bin/python2.7 /usr/bin/python
RUN echo "sqlexec 2021/tcp" >> /etc/services

RUN mkdir /home/informix/legacy-member-processor
COPY . /home/informix/legacy-member-processor

WORKDIR /home/informix/legacy-member-processor

RUN rm -rf node_modules && npm install --unsafe-perm

ENTRYPOINT [ "node", "src/app.js" ]
