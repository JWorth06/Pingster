FROM node:6.10.0-onbuild

# create app directory
RUN mkdir -p /pingbot/node_modules

WORKDIR /pingbot

RUN chown -R node.node /pingbot

USER node

#install botkit
COPY index.js /pingbot
COPY bot.js /pingbot/node_modules
COPY pingster_start.sh /pingbot

RUN npm install redis@2.7.1 @slack/client@3.9.0 express@4.15.2 google-auth-library@0.10.0 googleapis@18.0.0 nodemailer@3.1.7 sendmail@1.1.1 twilio@2.11.1

#set startup commands
ENTRYPOINT ["/pingbot/pingster_start.sh"]
