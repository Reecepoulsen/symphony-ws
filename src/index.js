const express = require('express')
const SpotifyWebApi = require('spotify-web-api-node')
const uuid = require('uuid');
const fs = require('fs');
const path = require('path');
const app = express()
const expressWs = require('express-ws')(app);

const PORT = 3000
// instructions
// http://localhost:3000/
// copy the code
// http://localhost:3000/sync?code=BQAXFV_QCN4xbHdSoZ7czaIRCSntMOg4kAHs2HWM841OUsIfPziMJGVHOU7X_BxVZ1UCygKzodKVPCUB1NkMPOBat3kNHts4xMG2CKfBor

// initialize
const my_client_id = '5dd2dda670184f4688b9eef425c31877'; // Symphony's permanent ID
const redirectURL = encodeURIComponent("http://localhost:3000/callback");

async function getSpotifyInfo(api, sendMessage) {
  sendMessage(JSON.stringify({state: "user-info"}));
  const user = await getUserInfo(api);
  if (!user) return;
  const username = user.id;
  sendMessage(JSON.stringify({state: "user-playlists"}));
  const playlists = await getUserPlaylists(api, username);
  const userPlaylists = playlists.filter(playlist => username === playlist.owner.id);
  sendMessage(JSON.stringify({state: "user-saved-tracks"}));
  const savedTracks = await getSavedTracks(api);
  sendMessage(JSON.stringify({state: "playlist-tracks"}));
  const playlistTracks = await getTracksFromPlaylists(api, userPlaylists.map(p => p.id));
  const tracks = playlistTracks.concat(savedTracks);
  sendMessage(JSON.stringify({state: "audio-features"}));
  const audioFeatures = await getTrackFeatures(api, tracks.map(p => p.id));
  const tracksWithAudioFeatures = mergeTracksWithFeatures(tracks, audioFeatures);
  sendMessage(JSON.stringify({state: "done"}));
  return {
    user,
    playlists: userPlaylists,
    tracks: tracksWithAudioFeatures,
  };
}

/***************************Helper functions****************************/
// Converts a list of objects to a dictionary by IDs
function objectListToDictById(objects) {
  return objects.reduce((acc, o) => (acc[o.id] = o, acc), {});
}

// Takes all duplicates out of tracks
function removeDuplicatesFromTracks(tracks) {
  const uniqueTracks = objectListToDictById(tracks);
  return Object.values(uniqueTracks);
}

// Because one object in the cloud without joins is easier
function mergeTracksWithFeatures(tracks, audioFeatures) {
  const trackDict = objectListToDictById(tracks);
  return audioFeatures.map(audioFeature => {
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
/***********************************************************************/


// First get the user, everything is connected to the user
async function getUserInfo(api) {
  try {
    const data = await api.getMe()
    return data.body;
  } catch (err) {
    console.log('Something went wrong!', err);
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
async function getSavedTracks(api) {
  return await getNextUntilDone(offset => api.getMySavedTracks({
    offset: offset * 50,
    limit: 50
  }));
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
async function getTracksFromPlaylists(api, playlistIds) {
  const playlistArrays = await Promise.all(playlistIds.map(id => getPlaylistTracks(api, id)));
  let playlistTracks = [];
  for (let playlistArray of playlistArrays) {
    playlistTracks = playlistTracks.concat(playlistArray);
  }
  const tracks = playlistTracks
    .map(pt => pt?.track)
    .filter(t => t != null)
    .filter(t => t.is_local == false);
  return removeDuplicatesFromTracks(tracks);
}

// gets all of the tracks associated with an individual playlist
async function getPlaylistTracks(api, playlistId) {
  return await getNextUntilDone(offset => api.getPlaylistTracks(playlistId, {
    offset: offset * 50,
    limit: 50
  }));
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
  // starts syncing the spotify data into firebase
  const token = req.query.access_token;
  if (token) {
    // Get the authenticated user
    api.setAccessToken(token);
    const id = uuid.v4();
    const wsapi = WebSocketAPI(id);
    getSpotifyInfo(api, wsapi.messageCallback).then((data) => {
      wsapi.messageCallback(JSON.stringify(data));
    })
    
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

function WebSocketAPI(id) {
  const messageCallback = (message) => {
    if (!(id in connections)) {
      connections[id] = {
        queue: [],
        sendWSMessage: undefined,
        messageCallback: messageCallback
      };
    }
    
    const connection = connections[id];
    if (message != undefined) {
      connection.queue.push(message);
    }
    if (connection.sendWSMessage !== undefined) {
      while (connection.queue.length) {
        connection.sendWSMessage(connection.queue.shift());
      }
    } else {
      console.log(connection, connections[id])
    }
  }

  return {messageCallback}
}


app.ws('/echo', function (ws, req) {
  ws.on('message', function (id) {
    console.log(id);
    if (id in connections) {
      connections[id].sendWSMessage = (message) => {
        ws.send(message);
      }
      console.log(connections);
    } else {
      console.log("bad connection id");
    }
  });
});



/***********************************************************************
 * Set port
 ***********************************************************************/
app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`)
})