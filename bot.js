'use strict';

const RtmClient = require('@slack/client').RtmClient;
const MemoryDataStore = require('@slack/client').MemoryDataStore;
const CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var WebClient = require('@slack/client').WebClient;
var token = process.env.SLACK_APP_TOKEN;
var web = new WebClient(token);
const request = require('request');

class Bot {
  constructor(opts) {
    let slackToken = opts.token;
    let autoReconnect = opts.autoReconnect || true;
    let autoMark = opts.autoMark || true;

    this.slack = new RtmClient(slackToken, { 
      // Sets the level of logging we require
      logLevel: 'error', 
      // Initialize a data store for our client, 
      // this will load additional helper
      // functions for the storing and retrieval of data
      dataStore: new MemoryDataStore(),
      // Boolean indicating whether Slack should automatically 
      // reconnect after an error response
      autoReconnect: autoReconnect,
      // Boolean indicating whether each message should be marked
      // as read or not after it is processed
      autoMark: autoMark
    });
	
	// The client will emit an RTM.AUTHENTICATED event on successful connection, with the `rtm.start` payload if you want to cache it
	/*
	this.slack.on(CLIENT_EVENTS.RTM.AUTHENTICATED, function (rtmStartData) {
	  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
	  console.log(JSON.stringify(rtmStartData));
	  web = new WebClient(rtmStartData.self.access_token);
	});
	*/
	
    this.slack.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, () => {
      let user = this.slack.dataStore.getUserById(this.slack.activeUserId)
      let team = this.slack.dataStore.getTeamById(this.slack.activeTeamId);

      this.name = user.name;

      console.log(`Connected to ${team.name} as ${user.name}`);      
    });
    // Create an ES6 Map to store our regular expressions
	this.keywords = new Map();

	this.slack.on(RTM_EVENTS.MESSAGE, (message) => {
	  // Only process text messages
	  if (!message.text) {
		return;
	  }
	
	  let channel = this.slack.dataStore.getChannelGroupOrDMById(message.channel);
	  let user = this.slack.dataStore.getUserById(message.user);

	  // Loop over the keys of the keywords Map object and test each
	  // regular expression against the message's text property
	  for (let regex of this.keywords.keys()) {    
		if (regex.test(message.text)) {
		  let callback = this.keywords.get(regex);
		  callback(message, channel, user);
		}
	  }
	
	});
    this.slack.start();
  }
  
  respondTo(keywords, callback, start) {
	  // If 'start' is truthy, prepend the '^' anchor to instruct the
	  // expression to look for matches at the beginning of the string
	  if (start) {
		keywords = '^' + keywords;
	  }

	  // Create a new regular expression, setting the case 
	  // insensitive (i) flag
	  let regex = new RegExp(keywords, 'i');

	  // Set the regular expression to be the key, with the callback
	  // function as the value
	  this.keywords.set(regex, callback);
  }

  // Send a message to a channel, with an optional callback
  send(message, channel, cb) {
    this.slack.sendMessage(message, channel.id, () => {
      if (cb) {
        cb();
      }
    });
  }
  
  getMembersByChannel(channel) {
    // If the channel has no members then that means we're in a DM
    if (!channel.members) {
      return false;
    }

    // Only select members which are not a bot
    let members = channel.members.filter((member) => {
      let m = this.slack.dataStore.getUserById(member);
      // Make sure user isn't a bot
      return (!m.is_bot);
    });

    // Get the names of the members
    members = members.map((member) => {
      return this.slack.dataStore.getUserById(member).name;
    });

    return members;
  }
  
  //Sends a customized message to the chat using a webhook
  sendChatMessage(Channel, textMsg){
	web.chat.postMessage(Channel, textMsg, function(err, res) {
		if (err) {
			console.log('Error:', err);
		} else {
			console.log('Message sent: ', res);
		}
	});
  }
  
  //Sends a customized message that can include attachments to the chat using a webhook
  sendChatMessage(Channel, textMsg, Opts){
	web.chat.postMessage(Channel, textMsg, Opts, function(err, res) {
		if (err) {
			console.log('Error:', err);
		} else {
			console.log('Message sent: ', res);
		}
	});
  }
  
  //pings slack to receive a pong
  ping(){
	  this.slack.send({type: 'ping'}, function(err, res) {
		if (err) {
			console.log('Error:', err);
		} else {
			console.log('Message received: ', res);
		}
	});
  }
  
  setTypingIndicator(channel) {
    this.slack.send({ type: 'typing', channel: channel.id });
  }

  getMemberbyName(name) {
    return this.slack.dataStore.getUserByName(name);
  }
  
  getMemberbyID(id) {
    return this.slack.dataStore.getUserById(id);
  } 
  
  getMemberDMbyID(id) {
    return this.slack.dataStore.getDMById(id);
  }
  
  getMemberDMbyName(name) {
    return this.slack.dataStore.getDMByName(name);
  }
  
   getChannel(id) {
    return this.slack.dataStore.getChannelGroupOrDMById(id);
  }
}
  
  
// Export the Bot class, which will be imported when 'require' is 
// used
module.exports = Bot;