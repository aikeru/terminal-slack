var ui = require('./userInterface.js'),
    slack = require('./slackClient.js'),
    fs = require('fs'),
    components = ui.init(), // ui components
    users,
    currentUser,
    channels,
    currentChannelId,

    // generates ids for messages
    getNextId = (function() {
        var id = 0;
        return function() {
            return id += 1;
        };
    })();

slack.init(function(data, ws) {
    currentUser = data.self;

    // don't update focus until ws is connected
    // focus on the channel list
    components.channelList.select(0);
    components.channelList.focus();
    // re render screen
    components.screen.render();

    //fs.appendFile('./ws_log.txt', '\n\n###############\n\n');
    ws.on('message', function(message, flags){
        message = JSON.parse(message);

        if ('reply_to' in message) {
            handleSentConfirmation(message);
        }
        else if (message.type === 'message') {
            handleNewMessage(message);
        }
    });

    // initialize these event handlers here as they allow functionality
    // that relies on websockets

    // event handler when message is submitted
    components.messageInput.on('submit', function(text) {
        var id = getNextId();
        components.messageInput.clearValue();
        components.messageInput.focus();
        components.chatWindow.insertBottom(
            '{bold}' + currentUser.name + '{/bold}: ' + text +
            ' (pending - ' + id +' )'
        );
        components.chatWindow.scroll(1);

        components.screen.render();
        ws.send(JSON.stringify({
            id: id,
            type: 'message',
            channel: currentChannelId,
            text: text
        }));
    });

    //msnead get user list from slack per passables
    // set the user list to the users returned from slack
     // call here to check against currentUser
     slack.getUsers(function(error, response, data){
         if (error || response.statusCode != 200) {
             console.log('Error: ', error, response || response.statusCode);
             return;
         }
 
         data = JSON.parse(data);
         users = [];
         for(var i = 0; i < data.members.length; i++) {
           //msnead made this a local decl
             var user = data.members[i];
             if(!user.deleted && user.id != currentUser.id) users.push(user);
         }
         components.userList.setItems(
            users.map(function(user) {
                return user.name;
            })
         );
     });
});

// set the channel list
components.channelList.setItems(['Connecting to Slack...']);
components.screen.render();

// set the channel list to the channels returned from slack
slack.getChannels(function(error, response, data, groupData){
    if (error || response.statusCode != 200) {
        console.log('Error: ', error, response || response.statusCode);
        return;
    }

    data = JSON.parse(data);
    groupData = JSON.parse(groupData);
    data.channels = data.channels.concat(groupData.groups.map((group) => {
     group.isGroup = true;
     return group;
    }));
    //msnead don't show archived channels
    channels = data.channels.filter((chan) => !chan.is_archived);
    components.channelList.setItems(
        channels.map(function(channel) {
            return channel.name;
        })
    );
});

// get list of users
//msnead commented this out per passables
//slack.getUsers(function(response, error, data){
    //users = JSON.parse(data).members;
//});
//

function getMessageText({ text, users, message }) {
  const regEx = /\<@[A-Z0-9]+\>/g
  //if(!text) { console.log('message?', Object.keys(message).join(','), JSON.stringify(message.files)) }
  return text.replace(regEx, (userRef) => {
    const userId = userRef.replace(/[\<\>@]/g, "")
    const user = users.find(u => u.id === userId)
    if(user) { return `{cyan-fg}${user.name}{/cyan-fg}` }
    return userId
  })
    .replace(/\*(\b\w*[-']*\w*\b)\*/g, (txt) => `{bold}${txt}{/bold}`)
    + (message.files && message.files.length ? message.files : [])
    .reduce((tot, next) => (tot ? tot + " " : tot) + (next.name || next.title) + " " + next.url_private_download, "")
    
}

updateMessages = function(data, markFn) {
     components.chatWindow.deleteTop(); // remove loading message
 
     // filter and map the messages before displaying them
     data.messages
         .filter(function(item) {
             return (item.type === 'message');
         })
         .map(function(message) {
             var len = users.length,
                 username;
 
             // get the author
             if(message.user === currentUser.id) username = currentUser.name
             else
                 for(var i=0; i < len; i++) {
                     if (message.user === users[i].id || message.bot_id === users[i].id || message.team_id) {
                         username = users[i].name;
                         break;
                     }
                 }
 
             const messageText = getMessageText({ text: message.text + " " + message.user + " " + message.bot_id, users, message })
             return {text: messageText, username: username};
         })
         .forEach(function(message) {
             // add messages to window
             components.chatWindow.unshiftLine(
                 '{bold}' + message.username + '{/bold}: ' + message.text
             );
         });
 
     // mark the most recently read message
     markFn(currentChannelId, data.messages[0].ts);
 
     // reset messageInput and give focus
     components.messageInput.clearValue();
     components.chatWindow.scrollTo(components.chatWindow.getLines().length);
     components.messageInput.focus();
     components.screen.render();
 };
console.log('Components userlist?',!!components.userList);
 components.userList.on('select', function(data) {
     var userName = data.content;
 
     // a channel was selected
     components.mainWindowTitle.setContent('{bold}' + userName + '{/bold}');
     components.chatWindow.setContent('Getting messages...');
     components.screen.render();
 
     // get user's id
     var userId = '';
     for(var i = 0; i < users.length; i++) {
         user = users[i];
         if(user.name === userName) {
             userId = user.id;
             break;
         }
     }
     slack.openIm(userId, function(error, response, data){
         data = JSON.parse(data);
         currentChannelId = data.channel.id;
 
         // load im history
         slack.getImHistory(currentChannelId, function(error, response, data) {
             data = JSON.parse(data);
             updateMessages(data, slack.markIm);
         });
     });
 });


// event handler when user selects a channel
components.channelList.on('select', function(data) {
    var channelName = data.content;

    // a channel was selected
    components.mainWindowTitle.setContent('{bold}' + channelName + '{/bold}');
    components.chatWindow.setContent('Getting messages...');
    components.screen.render();

    // join the selected channel
    var selectedChannel = channels.find((chan) => chan.name === channelName);
    if(selectedChannel.isGroup) {
      //assume we are already part of the group
      currentChannelId = selectedChannel.id;
      slack.getGroupHistory(currentChannelId, (err, resp, data) => {
        var data = JSON.parse(data);
        updateMessages(data, () => {
          //this would normally mark messages read or something
          //markChannel
          //but this is a group, so no
        });
      });
    } else {
    
      slack.joinChannel(channelName, function(error, response, data) {
        //msnead
          //if (error || response.statusCode != 200) {
              //console.log('Error: ', error, response || response.statusCode);
              //return;
          //}

          data = JSON.parse(data);
          currentChannelId = data.channel.id;

          // get the previous messages of the channel and display them
          slack.getChannelHistory(currentChannelId, function(error, response, data) {
            //msnead
              //if (error || response.statusCode != 200) {
                  //console.log('Error: ', error, response || response.statusCode);
                  //return;
              //}

              data = JSON.parse(data);
              //msnead
              updateMessages(data, slack.markChannel);
              //msnead
              //components.chatWindow.deleteTop(); // remove loading message

              //// filter and map the messages before displaying them
              //var messages = data.messages
                  //.filter(function(item) {
                      //return (item.type === 'message');
                  //});
              //messages
                  //.map(function(message) {
                      //var len = users.length,
                          //username;

                      //// get the author
                      //for(var i=0; i < len; i++) {
                          //if (message.user === users[i].id) {
                              //username = users[i].name;
                          //}
                      //}

                      //return {text: message.text, username: username};
                  //})
                  //.forEach(function(message) {
                      //// add messages to window
                      //components.chatWindow.unshiftLine(
                          //'{bold}' + message.username + '{/bold}: ' + message.text
                      //);
                  //});

              //// reset messageInput and give focus
              //components.messageInput.clearValue();
              //components.chatWindow.scrollTo(components.chatWindow.getLines().length);
              //components.messageInput.focus();
              //components.screen.render();

              //// mark the most recently read message
              //slack.markChannel(currentChannelId, messages[0].ts);
          });
      });
    }
});

// handles the reply to say that a message was successfully sent
function handleSentConfirmation(message) {
    // for some reason getLines gives an object with int keys
    var lines = components.chatWindow.getLines(),
        keys = Object.keys(lines),
        line, i;
    for(i=keys.length - 1; i >= 0; i--){
        line = lines[keys[i]].split('(pending - ');
        if (parseInt(line.pop()[0]) === message.reply_to) {

            components.chatWindow.deleteLine(parseInt(keys[i]));

            if (message.ok) {
                components.chatWindow.insertLine(i, line.join(''));
            }
            else {
                components.chatWindow.insertLine(i, line.join('') + ' (FAILED)');
            }
            break;
        }
    }
    components.chatWindow.scroll(1);
    components.screen.render();
}

function handleNewMessage(message) {
    if(message.channel !== currentChannelId) {
        return;
    }

    var len = users.length,
        username;

    // get the author
    for(var i=0; i < len; i++) {
        if (message.user === users[i].id) {
            username = users[i].name;
        }
    }
    components.chatWindow.insertBottom(
        '{bold}' + username + '{/bold}: ' + message.text
    );
    components.chatWindow.scroll(1);
    components.screen.render();
}
