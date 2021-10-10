const express = require('express')
const SpotifyWebApi = require('spotify-web-api-node')
const uuid = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express()
const expressWs = require('express-ws')(app);

// Set up firebase
const admin = require('firebase-admin');
const serviceAccount = require('../firebaseSDKinfo.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const PORT = 3000
// instructions
// http://localhost:3000/
// copy the code
// http://localhost:3000/sync?code=BQAXFV_QCN4xbHdSoZ7czaIRCSntMOg4kAHs2HWM841OUsIfPziMJGVHOU7X_BxVZ1UCygKzodKVPCUB1NkMPOBat3kNHts4xMG2CKfBor

// initialize
const my_client_id = '5dd2dda670184f4688b9eef425c31877'; // Symphony's permanent ID
const redirectURL = encodeURIComponent("http://localhost:3000/callback");

// downloads the information from spotify api and send status updates to browser
async function getSpotifyInfo(api, messageCallback) {
  const codes = LOADING_CODE;

  messageCallback(codes.USER_INFO);
  const user = await getUserInfo(api);
  if (!user) throw 'Invalid User Token';
  const username = user.id;

  messageCallback(codes.USER_PLAYLISTS);
  const playlists = await getUserPlaylists(api, username);
  const userPlaylists = playlists.filter(playlist => username === playlist.owner.id);
  // add liked songs playlist
  userPlaylists.push({
      "collaborative": false,
      "id": user.id,
      "name": "Liked Songs",
      "owner": user,
      "public": false,
      "type": "playlist",
  });

  messageCallback(codes.USER_SAVED_TRACKS);
  const savedPlaylistItems = await getSavedItems(api, user.id);

  messageCallback(codes.PLAYLIST_TRACKS);
  const playlistItems = await getPlaylistItemsFromPlaylists(api, userPlaylists.map(p => p.id));
  const allPlaylistItems = playlistItems.concat(savedPlaylistItems);

  // add all the tracks to their playlists
  putTrackIdsIntoPlaylist(userPlaylists, allPlaylistItems);
  // prepare for export
  const allTracks = removeDuplicatesFromTracks(convertPlaylistItemsToTracks(allPlaylistItems));

  messageCallback(codes.AUDIO_FEATURES);
  const audioFeatures = await getTrackFeatures(api, allTracks.map(p => p.id));
  const tracksWithAudioFeatures = mergeTracksWithFeatures(allTracks, audioFeatures);
  
  return {
    user,
    playlists: userPlaylists,
    tracks: tracksWithAudioFeatures,
  };
}

/***************************Helper functions****************************/
// Converts a list of objects to a dictionary by IDs
function objectListToDictById(objects) {
  return objects.filter(o=>o && o.id != null).reduce((acc, o) => (acc[o.id] = o, acc), {});
}

// Takes all duplicates out of tracks
function removeDuplicatesFromTracks(tracks) {
  const uniqueTracks = objectListToDictById(tracks);
  return Object.values(uniqueTracks);
}

// Because one object in the cloud without joins is easier
function mergeTracksWithFeatures(tracks, audioFeatures) {
  const trackDict = objectListToDictById(tracks);
  return audioFeatures.filter(af=>af!=null).map(audioFeature => {
    return {
      ...audioFeature,
      ...trackDict[audioFeature.id],
      type: "total_track_info"
    };
  });
}

// puts a thread to sleep. Used for waiting for rate limiting retries
async function wait(seconds) {
  return await new Promise(r => setTimeout(r, seconds * 1000));
}

// could have a use. Instead of calling all values at once, it does map serially.
async function asyncMap(values, func) {
  const acc = [];
  while (values.length) {
    acc.push(await func(values.pop()));
  }
  return acc.reverse();
}

function convertPlaylistItemsToTracks(playlistTracks) {
  return playlistTracks
    .map(pt => pt?.track)
    .filter(t => t != null)
    .filter(t => t.id != null)
    .filter(t => t.is_local == false);
}

function putTrackIdsIntoPlaylist(playlists, playlistTracks) {
  const playlistsDict = objectListToDictById(playlists);
  playlists.forEach(p=>{
    p.tracks = [];
  })
  playlistTracks.filter(pt=>pt!=null).forEach(pt => {
    const pid = pt.playlistId;
    if (pid in playlistsDict) {
      playlistsDict[pid].tracks.push({
        id: pt.track.id,
        added_at: pt.added_at
      });
    } else {
      console.log("could not find playlist id");
    }
  });
}

/***********************************************************************/


// First get the user, everything is connected to the user
async function getUserInfo(api) {
  try {
    const data = await api.getMe()
    return data.body;
  } catch (err) {
    console.log('Something went wrong!', err);
    if (err.statusCode == 401) {
      // TODO REPORT
    }
    return undefined;
  }
}


// General function to get the next request in a list of requests 
async function getNextUntilDone(func, listKeyName, endOffset) {
  // TODO: make this concurrent for faster loading times.

  const id = Math.floor(Math.random() * 1000);
  console.log("started getNextUntilDone with id", id);

  if (listKeyName == null) {
    listKeyName = "items";
  }
  // getUP or getST
  let items = [];
  let offset = 0;
  while (true) {
    try {
      const data = await func(offset);
      offset += 1;
      if (data.body[listKeyName]) {
        items = items.concat(data.body[listKeyName]);
      }
      if (endOffset != null) {
        if (endOffset <= offset) {
          return items;
        }
      } else if (!data.body.next) {
        return items;
      }
    } catch (err) {
      if (err.statusCode == 429) {
        const retryAfterSeconds = parseInt(err.headers["retry-after"]);
        console.log(id, "got rate limited. Going to sleep for", retryAfterSeconds, "seconds");
        await wait(retryAfterSeconds + 1);
        console.log(id, "done waiting")
      } else {
        console.log(id, 'Something went wrong');
        return items;
      }
    }
  }
}


// Requests all of the saved tracks for a user
async function getSavedItems(api, playlistId) {
  const savedPlaylistItems = await getNextUntilDone(offset => api.getMySavedTracks({
    offset: offset * 50,
    limit: 50
  }));
  return savedPlaylistItems.map(i => {
    i.playlistId = playlistId;
    return i;
  });
}


/*************************Handle playlists********************************/
// Gets a list of the user's playlists (not including songs)
async function getUserPlaylists(api, username) {
  return await getNextUntilDone(offset => api.getUserPlaylists(username, {
    offset: offset * 50,
    limit: 50
  }));
}

// processes all playlists, filter to get rid of the nulls, sends to getPlaylistTracks
async function getPlaylistItemsFromPlaylists(api, playlistIds) {
  const playlistArrays = await Promise.all(playlistIds.map(id => getPlaylistItems(api, id)));
  let playlistItems = [];
  for (let playlistArray of playlistArrays) {
    playlistItems = playlistItems.concat(playlistArray);
  }
  return playlistItems;
}

// gets all of the tracks associated with an individual playlist
async function getPlaylistItems(api, playlistId) {
  const playlistItems = await getNextUntilDone(offset => api.getPlaylistTracks(playlistId, {
    offset: offset * 50,
    limit: 50
  }));
  playlistItems.forEach(pi => {
    pi.playlistId = playlistId;
    return pi;
  });
  return playlistItems;
}
/***********************************************************************/

// gets the specific info about the track
async function getTrackFeatures(api, trackIds) {
  const APIlimit = 100; // spotify limits the track features to 100
  return await getNextUntilDone(offset => api.getAudioFeaturesForTracks(
      trackIds.slice(offset * APIlimit, (offset + 1) * APIlimit)),
    "audio_features",
    Math.ceil(trackIds.length / APIlimit)
  );
}


/***********************************************************************
 * Serve HTML 
 ***********************************************************************/
app.use(express.static('public'))

app.get('/login', function (req, res) {
  var scopes = [
    "user-read-private",
    "user-read-email",
    "playlist-read-private",
    "user-library-read"
  ];
  res.redirect(`https://accounts.spotify.com/authorize?client_id=${my_client_id}&redirect_uri=${redirectURL}&response_type=token&state=123&scope=${scopes.join(" ")}`);
});


app.get('/sync', async (req, res) => {
  var api = new SpotifyWebApi({
    clientId: my_client_id,
    redirectUri: 'http://localhost:3000/callback'
  });
  const token = req.query.access_token;
  if (token) {
    // Get the authenticated user
    api.setAccessToken(token);
    
    const id = uuid.v4();
    const wsapi = WebSocketAPI(id);
    // TODO: check if stuff is already in firebase
    getSpotifyInfo(api, wsapi.messageCallback).then((data) => {
      // send data to the browser
      wsapi.messageCallback(data);

      /***********************************************************************
      * Send data to firebase
      ***********************************************************************/
      
      // Create the user in database
      wsapi.messageCallback(LOADING_CODE.UPLOAD_USER_INFO);
      const userDocRef = db.collection('users').doc(data.user.id);
      userDocRef.set(data.user)
        .then(function () {
          console.log("Added a User");
        })
        .catch(error => {
          console.log("An error occured: ", error);
        });
        

      // Helper function to gather lists of playlists/tracks into batches
      // of 500 and add to database (Spotify API limits to calls of 500 every second) 
      async function limitBatchTo500(colName, items) {
        let count = 0;

        while (count < items.length) {
          currentBatchItems = items.slice(count, count + 500);
          
          // Create the user's playlists in database
          wsapi.messageCallback(LOADING_CODE.USER_PLAYLISTS);
          let batch = db.batch();
          currentBatchItems.forEach((item) => {
            const docRef = db.collection(colName).doc(item.id)
            batch.set(docRef, item);
          });
          await batch.commit();

          count += currentBatchItems.length;
        }
      }

      // Create the user's playlists
      wsapi.messageCallback(LOADING_CODE.UPLOAD_PLAYLISTS);
      limitBatchTo500("playlists", data.playlists);

      // Create the user's tracks in database
      wsapi.messageCallback(LOADING_CODE.UPLOAD_TRACKS);
      limitBatchTo500("tracks", data.tracks);

      // after uploaded
      wsapi.messageCallback(LOADING_CODE.DONE);
    }).catch((error)=>{
      console.log(error);
      wsapi.messageCallback(STATUS_CODE.INVALID_TOKEN);
    });
    
    fs.readFile(path.join('private', 'login-success.html'), function (err, data) {
      if (err) {
        res.sendStatus(404);
      } else {
        const contents = data.toString().replaceAll(/##id##/g, id);
        res.send(contents);
      }
    });
  } else {
    fs.readFile(path.join('private', 'login-failed.html'), function (err, data) {
      if (err) {
        res.sendStatus(404);
      } else {
        res.send(data);
      }
    });
  }
})


/***********************************************************************
 * Serve WebSocket Connection
 ***********************************************************************/

const connections = {};

const LOADING_CODE = {
  INITIALIZE: "",
  USER_INFO: "",
  USER_PLAYLISTS: "",
  USER_SAVED_TRACKS: "",
  PLAYLIST_TRACKS: "",
  AUDIO_FEATURES: "",
  UPLOAD_USER_INFO: "",
  UPLOAD_PLAYLISTS: "",
  UPLOAD_TRACKS: "",
  DONE: "",
};
const STATUS_CODE = {
  INVALID_TOKEN: {error: 'invalid-token', message: 'please get new token'}
}
// build LOADING_CODE
Object.keys(LOADING_CODE).forEach((v,i) => {
  LOADING_CODE[v] = {
    name: v,
    index: i,
    total: Object.keys(LOADING_CODE).length
  };
});
console.log(LOADING_CODE)

function WebSocketAPI(id) {
  const messageCallback = (data) => {
    if (!(id in connections)) {
      connections[id] = {
        queue: [],
        sendWSMessage: undefined,
        messageCallback: messageCallback
      };
    }
    
    const connection = connections[id];
    if (data != undefined) {
      connection.queue.push(JSON.stringify(data));
    }
    if (connection.sendWSMessage !== undefined) {
      while (connection.queue.length) {
        connection.sendWSMessage(connection.queue.shift());
      }
    }
  }

  return {messageCallback}
}


app.ws('/progress', function (ws, req) {
  ws.on('message', function (id) {
    console.log(id);
    if (id in connections) {
      connections[id].sendWSMessage = (message) => {
        ws.send(message);
      }
    } else {
      console.log("bad connection id");
      ws.send(JSON.stringify({error: "bad connection id"}));
    }
  });
});



/***********************************************************************
 * Set port
 ***********************************************************************/
app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`)
})