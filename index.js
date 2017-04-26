'use strict';

//building global variables
var redis = require('redis');
var Bot = require('/pingbot/node_modules/bot.js');
var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var client = redis.createClient('6379', process.env.REDIS_HOST);
var nodemailer = require('nodemailer');
var twilio = require('twilio');
var twilioclient = new twilio.RestClient(process.env.TWILIO_ACC_SID ,process.env.TWILIO_AUTH_TOKEN);
var messages_in_channels = {};
var pinged_in_channels = {};
var stalked_people = {};
var express = require('express')
var app = express()
var request = require('request');

//Makes instance of the bot
const bot = new Bot({
  token: process.env.SLACKTOKEN,
  autoReconnect: true,
  autoMark: true
});

//Reports an error if there is a problem connecting to the database
client.on('error', (err) => {
    console.log('Error ' + err);
});

//Confirms the bot connected to the database
client.on('connect', () => {
  console.log('Connected to Redis!');
});


//Authenticates this app for Google Sheets
setInterval(function () {
  var jsonPath = '/run/secrets/sheets.googleapis.com-nodejs-quickstart.json';
  var clientSecret = process.env.GOOGLE_CLI_SEC;
  var clientId = process.env.GOOGLE_CLI_ID;
  var redirectUrl = process.env.GOOGLE_REDIR_URL;
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  fs.readFile(jsonPath, function(err, token) {
    if (err) {
      console.log('Error reading Token.');
    } else {
      oauth2Client.credentials = JSON.parse(token);
      pullSheetsData(oauth2Client);
      console.log('Data was pulled successfully');
    }
  });
}, 30000);

//Pulls the data from google sheets and stores it into the redis database.
function pullSheetsData(auth) {
  var sheets = google.sheets('v4');
  sheets.spreadsheets.values.get({
    auth: auth,
    spreadsheetId: process.env.GOOGLE_SPDSHT_ID,
    range: 'Directory!A2:M',
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }
    var rows = response.values;
    if (rows.length == 0) {
      console.log('No data found.');
    } else {
        //console.log(JSON.stringify(rows));
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];

            //initializes variables for storing
            let key = row[0].toLowerCase();
            client.del(key);
            let slackid = row[3].toLowerCase();
            let cellnum = '+' + row[4];
            let escalation = row[8];
            let escalationtime = row[9] * 60;


            //console.log(JSON.stringify(row));
            //makes sure there are enough arguments
            if (escalation == null){
                console.log('Oops! You need to enter Name, slackid, cell number, and person to be esacalated to. :(');
                return;
            }

            //stores them in the database
            client.rpush(key, [slackid,cellnum,escalation,escalationtime], (err) => {
            if (err) {
                console.log('Oops! There was an error when trying to pull the data from sheets :(');
            }
            });

        }
    }
  });
}

//This runs every 10 seconds to clear out old message entries, clear out pings that were responded to, and escalate pings.
setInterval(function () {
  for(var stalkedperson in stalked_people){
      let stalkedUser = bot.getMemberbyID(stalkedperson);
      if(stalkedUser.presence == 'active'){
        for(var i = Object.keys(stalked_people[stalkedperson]).length - 1; i >= 0; i--){
            let dm = bot.getMemberDMbyName(stalked_people[stalkedperson][i]);
            console.log(JSON.stringify(dm));
            bot.slack.sendMessage(`${stalkedUser.name} is now active`, dm.id);
        }
        stalked_people[stalkedperson].splice(i,1);
      }
  }

}, 10000);

//This runs every 30 seconds to clear out old message entries, clear out pings that were responded to, and escalate pings.
setInterval(function () {

    removeOldMessages();

    removeMatchedPings();

    escalateToCall();

    escalateMissedPing();

    console.log('Message JSON:');
    console.log(JSON.stringify(messages_in_channels));
    console.log('Ping JSON:');
    console.log(JSON.stringify(pinged_in_channels));
    console.log('Stalk JSON:');
    console.log(JSON.stringify(stalked_people));
}, 30000);


//This runs every 5 seconds to ping Slack so the bot doesn't time out.
setInterval(function () {

    bot.ping();

}, 5000);


//Pings the person and stores it in the pinged JSON object
bot.respondTo('ping', (message, channel, user) => {

  bot.setTypingIndicator(message.channel);
  //let members = bot.getMembersByChannel(channel);   //gets information of everyone in the channel and the person to ping
  let key = getArgs(message.text).shift();


  client.lrange(key, 0, -1, (err, reply) => {        //pulls information from the database
    if (err) {
        console.log(err);
        bot.send('Oops! There was an error pulling that information from the database. :(', channel);
        return;
    }

    if(message.channel.toString().charAt(0) == 'D'){            //error if it is a direct message
        bot.send('You can\'t ping in a Direct Message chat room', channel);
        return;
    }

    /*
    if ((members.indexOf(reply[0]) < 0)) {                        //if -1 is returned, the person is not in the chat or inactive
        bot.send(`Sorry ${user.name}, but I either can't find ${reply} in this channel, they are offline, or they are a bot!`, channel);
        return;
    }
    */

    let msgtopingee = `You are needed in ${channel.name}: slack://channel?id=${channel.id}&team=T025W1LAM`;            //define message to send, extract phone number, and get the direct message
    let phonenum = reply[1];
	
	let pingedUser = bot.getMemberbyName(key);
	let dm = bot.getMemberDMbyID(pingedUser);

    if(dm == undefined){                                        //bot gives an error in the channel if there isn't a direct message open or sends a messsage if it is opened.
      bot.send(`Sorry ${user.name}, I cannot send that user a direct message because he does not have a direct message with me open.`, channel);
    }
    else{
      console.log('SENDING DM');
      bot.slack.sendMessage(msgtopingee, dm.id);
    }

    console.log('SENDING TEXT')
    twilioText(phonenum, msgtopingee);
    twilioCall(phonenum);

    storePingInfo(reply[0], message.ts, key, message.channel, reply[3]);

  });
}, true);


//Stores all messages in a JSON object
bot.respondTo('test', (message, channel, user) => {

    if(!user){
        return;
    }

    let textMessage = 'Testing message';
    let extras = {
        "attachments": [
        {
            "text": "Choose a game to play",
            "fallback": "You are unable to choose a game",
            "callback_id": "wopr_game",
            "color": "#3AA3E3",
            "attachment_type": "default",
            "actions": [
                {
                    "name": "game",
                    "text": "Chess",
                    "type": "button",
                    "value": "chess"
                },
                {
                    "name": "game",
                    "text": "Falken's Maze",
                    "type": "button",
                    "value": "maze"
                },
                {
                    "name": "game",
                    "text": "Thermonuclear War",
                    "style": "danger",
                    "type": "button",
                    "value": "war",
                    "confirm": {
                        "title": "Are you sure?",
                        "text": "Wouldn't you prefer a good game of chess?",
                        "ok_text": "Yes",
                        "dismiss_text": "No"
                    }
                }
            ]
    }]};

    let compiledMessage = {
        'token' : process.env.SLACKTOKEN,
        'channel' : channel.id,
        'text': textMessage
    }

    console.log(JSON.stringify('Channel ID: ',channel.id));
    console.log(JSON.stringify('Text Message :',textMessage));
    //bot.sendChatMessage(channel.id, textMessage);
    bot.sendChatMessage(channel.id, textMessage, extras);

}, true);


//Test for time outputs in javascript
bot.respondTo('time', (message, channel, user) => {

    let d = new Date();
    let theDay = d.getDay();
    let theHour = d.getHours();
    let theMinute = d.getMinutes();

    let theTime = theDay.toString() + " " + theHour.toString() + ":" + theMinute.toString();

    console.log(theDay);
    console.log(theHour);
    console.log(theMinute);
    console.log(theTime);

}, true);

//Notifies you when the user becomes active again.
bot.respondTo('stalk', (message, channel, user) => {

  bot.setTypingIndicator(message.channel);
  let key = getArgs(message.text).shift();

  let stalkedUser = bot.getMemberbyName(key);

  if (stalked_people[stalkedUser.id]){
    stalked_people[stalkedUser.id].push(user.name);
  }
  else {
    stalked_people[stalkedUser.id] = [];
    stalked_people[stalkedUser.id].push(user.name);
  }

  console.log('User JSON:');
  console.log(JSON.stringify(stalkedUser));
  console.log('Stalk JSON:');
  console.log(JSON.stringify(stalked_people));
  bot.send(`Now stalking ${key}.`, channel);

}, true);

//Stores all messages in a JSON object
bot.respondTo('', (message, channel, user) => {
    if(!user){
        return;
    }

    storeMessageInfo(user.name, message.ts, message.channel);

    console.log('Message JSON:');
    console.log(JSON.stringify(messages_in_channels));
    console.log('Ping JSON:');
    console.log(JSON.stringify(pinged_in_channels));
    console.log('Stalk JSON:');
    console.log(JSON.stringify(stalked_people));

}, true);

//Stores the ping information into a JSON object
function storePingInfo(username, thetime, id, channel, escalationtime) {
  var holder = {user : username, timestamp : thetime, who: id, time: escalationtime};

  if (pinged_in_channels[channel]){
    pinged_in_channels[channel].push(holder);
  }
  else {
    pinged_in_channels[channel] = [];
    pinged_in_channels[channel].push(holder);
  }
}

//Stores the message information into a JSON object
function storeMessageInfo(username, thetime,  channel) {

  var holder = {user : username, timestamp : thetime};

  if (messages_in_channels[channel]){
    messages_in_channels[channel].push(holder);
  }
  else {
    messages_in_channels[channel] = [];
    messages_in_channels[channel].push(holder);
  }
}

//If the text/DM hasn't been responded to in 5 minutes, a call is made to the user
function escalateToCall(){
    for(var slackchannel1 in pinged_in_channels){
        for(var i = Object.keys(pinged_in_channels[slackchannel1]).length - 1; i >= 0; i--){
            if(pinged_in_channels[slackchannel1][i]['timestamp'] < (Math.floor(new Date() / 1000) - 30)){
                client.lrange(pinged_in_channels[slackchannel1][i]['who'], 0, -1, (err, reply) => {
                    if (err) {
                     console.log(err);
                     bot.send('Oops! I tried to retrieve something but something went wrong :(', channel.id);
                     return;
                    }
                    let phonenum = reply[1];
                    console.log('MAKING PHONE CALL');
                    console.log(phonenum);
                    twilioCall(phonenum);

                });
            }
        }
    }
};


//Looks through the pinged list for people that haven't resopnded in the given room yet.
//If it has been over the given amount of time, it runs a modified ping process to escalate to the next person.
function escalateMissedPing(){
    for(var slackchannel1 in pinged_in_channels){
        for(var i = Object.keys(pinged_in_channels[slackchannel1]).length - 1; i >= 0; i--){
            if(pinged_in_channels[slackchannel1][i]['timestamp'] < (Math.floor(new Date() / 1000) - pinged_in_channels[slackchannel1][i]['time'])){

                let thischannel = bot.getChannel(slackchannel1);

                client.lrange(pinged_in_channels[slackchannel1][i]['who'], 0, -1, (err, reply) => {
                    if (err) {
                     console.log(err);
                     bot.send('Oops! I tried to retrieve something but something went wrong :(', thischannel);
                     return;
                    }

                    bot.send(`ping ${reply[2]}`, thischannel);
                    console.log('Pinging new person :');
                    console.log(JSON.stringify(pinged_in_channels[slackchannel1][i]));

                    client.lrange(reply[2], 0, -1, (err, newpingee) => {
                        if (err) {
                         console.log(err);
                         bot.send('Oops! I tried to retrieve something but something went wrong :(', channel.id);
                         return;
                        }

                        let msgtopingee = `You are needed in ${thischannel.name}: slack://channel?id=${thischannel.id}&team=T025W1LAM`;
                        let phonenum = newpingee[1];

                        let dm = bot.getMemberDMbyName(newpingee[0]);

                        if(dm == undefined){                                        //bot gives an error in the channel if there isn't a direct message open or sends a messsage if it is opened.
                          bot.send(`Sorry ${user.name}, I cannot send that user a direct message because he does not have a direct message with me open.`, channel);
                        }
                        else{
                          bot.slack.sendMessage(msgtopingee, dm.id);
                          console.log('SENDING ESCALATED DM');
                        }

                        console.log('SENDING ESCALATED TEXT')
                        twilioText(phonenum, msgtopingee);


                        let thetime = (Math.floor(new Date() / 1000));
                        storePingInfo(newpingee[0], thetime, reply[2], slackchannel1);

                    });

                    pinged_in_channels[slackchannel1].splice(i,1);
                });
            }
        }
    }
};

//Iterates over the messages that have been sent and cleared out anything that is more than x seconds old
//Based on the last number in the "(Math.floor(new Date() / 1000) - 120)" expression
function removeOldMessages(){
    for(var slackchannel2 in messages_in_channels){
        for(var i = Object.keys(messages_in_channels[slackchannel2]).length - 1; i >= 0; i--){
            if(messages_in_channels[slackchannel2][i]['timestamp'] < (Math.floor(new Date() / 1000) - 120)){
                console.log('Removing old message:');
                console.log(JSON.stringify(messages_in_channels[slackchannel2][i]));
                messages_in_channels[slackchannel2].splice(i,1);
            }
        }
    }
}

//compares the list of messages and the people who have been pinged.
//If the person has responded in the same room, it removes them from the pinged list.
function removeMatchedPings(){
    for(var slackchannel1 in pinged_in_channels){
        for(var slackchannel2 in messages_in_channels){
            if(slackchannel1 == slackchannel2){
                for(var slackgroup2 in messages_in_channels[slackchannel2]){
                    for(var i = Object.keys(pinged_in_channels[slackchannel1]).length - 1; i >= 0; i--){
                        if(pinged_in_channels[slackchannel1][i]['user'] == messages_in_channels[slackchannel2][slackgroup2]['user']){
                            console.log('Removing ping that were responded to :');
                            console.log(pinged_in_channels[slackchannel1][i]);
                            pinged_in_channels[slackchannel1].splice([i],1);
                        }
                    }
                }
            }
        }
    }
}

//Take the message text and return the arguments
function getArgs(msg) {
  return msg.split(' ').slice(1);
}


// Pass in parameters to the REST API using an object literal notation. The
// REST client will handle authentication and response serialzation for you.
function twilioText(userPhone, textMessage){
    twilioclient.messages.create({
        to: userPhone,
        from: process.env.TWILIO_PHONE_NUM,
        body: textMessage
    }, function(error, message) {
        // The HTTP request to Twilio will run asynchronously. This callback
        // function will be called when a response is received from Twilio
        // The "error" variable will contain error information, if any.
        // If the request was successful, this value will be "falsy"
        if (!error) {
            // The second argument to the callback will contain the information
            // sent back by Twilio for the request. In this case, it is the
            // information about the text messsage you just sent:
            console.log('Success! The SID for this SMS message is:');
            console.log(message.sid);

            console.log('Message sent on:');
            console.log(message.dateCreated);
        } else {
            console.log(error);
        }
    });
}

function twilioCall(userPhone){
    twilioclient.calls.create({
        url: process.env.TWILIO_PHONE_URL,
        from: process.env.TWILIO_PHONE_NUM,
        to:userPhone,
    }, function(err, call) {
        if(err){
          console.log(err);
        }else{
          console.log('call successful');
        }
    });
}


//DEPRECATED FUNCTIONS
/*
//Allows users to store a call name, slack id, cell number, and escalation person in the database
bot.respondTo('store', (message, channel, user) => {
  let args = getArgs(message.text);

  //initializes variables for storing
  let key = args.shift();
  client.del(key);
  let slackid = args[0];
  let cellnum = args[1];
  let escalation = args[2];

  //makes sure there are enough arguments
  if (escalation == null){
      bot.send('Oops! You need to enter Name, slackid, cell number, and person to be esacalated to. :(', channel);
      return;
    }

  //stores them in the database
  client.rpush(key, [slackid,cellnum,escalation], (err) => {
    if (err) {
      bot.send('Oops! There was an error when trying to store the data :(', channel);
    } else {
      bot.send(`Okay ${user.name}, I will remember that for you.`, channel);
    }
  });
}, true);

//Allows user to see what information is stored in a given key
bot.respondTo('retrieve', (message, channel, user) => {
  bot.setTypingIndicator(message.channel);

  //gets key from user
  let key = getArgs(message.text).shift();

  //gets list from database
  client.lrange(key, 0, -1, (err, reply) => {
    if (err) {
     console.log(err);
     bot.send('Oops! There was an error when trying to retrieve that value of that key :(', channel);
     return;
    }

    bot.send('Here\'s what I remember: ' + reply, channel);
  });
}, true);


//The sendmail function taken from the sendmail/nodemailer module
function sendemail(phonenum, emailmsg, slackroomid){

    let emailrecipient = phonenum + '@vzwpix.com';

    let transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: 'XXXXXXXX',
            pass:  'XXXXXXXXXXXX'
        },
        debug: true // include SMTP traffic in the logs
    }, {
        // sender info
        from: 'XXXXXXXXXXXXX',
    });

    let message = {
        to: emailrecipient,
        subject: 'You\'re needed in Slack',
        text: emailmsg,
        html: emailmsg,
    };

    transporter.sendMail(message, (error, info) => {
        if (error) {
            console.log('Error occurred with the transporter.');
            console.log(error.message);
            return;
        }
        console.log('Message sent successfully!');
        console.log(JSON.stringify(info));
        console.log('Server responded with "%s"', info.response);
        transporter.close();
    });
}
*/
