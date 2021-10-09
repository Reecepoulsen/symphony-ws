const e = require('express');
const express = require('express')
const SpotifyWebApi = require('spotify-web-api-node')
const app = express()
const port = 3000
// instructions
// http://localhost:3000/
// copy the code
// http://localhost:3000/sync?code=BQAXFV_QCN4xbHdSoZ7czaIRCSntMOg4kAHs2HWM841OUsIfPziMJGVHOU7X_BxVZ1UCygKzodKVPCUB1NkMPOBat3kNHts4xMG2CKfBor

// initialize
const my_client_id = '5dd2dda670184f4688b9eef425c31877'; // Symphony's permanent ID
const redirectURL = encodeURIComponent("http://localhost:3000/callback");

async function getSpotifyInfo(api) {
  const user = await getUserInfo(api);
  if (!user) return;
  const username = user.id;
  const playlists = await getUserPlaylists(api, username);
  const userPlaylists = playlists.filter(playlist => username === playlist.owner.id);
  // console.log(userPlaylists)
  // const userSavedTracks = await getUserSavedTracks(api);
  // console.log(userSavedTracks);
  
  // TODO RATE LIMIT TO 10 PLAYLISTS
  const tracks = await getTracksFromPlaylists(api, userPlaylists.map(p=>p.id).slice(0, 10));
  const audioFeatures = await getTrackFeatures(api, tracks.map(p=>p.id));
  // const tracksWithAudioFeatures = await mergeTracksWithFeatures(tracks, audioFeatures);
  return {
    user,
    userPlaylists,
    //savedTracks,
    tracks,
    audioFeatures,
  };
}

/***************************Helper functions****************************/
// Converts a list of objects to a dictionary by IDs
function objectListToDictById(objects) {
  return objects.reduce((acc,o)=> (acc[o.id]=o, acc), {});
}

// Takes all duplicates out of tracks
function removeDuplicatesFromTracks(tracks) {
  const uniqueTracks = objectListToDictById(tracks);
  return Object.values(uniqueTracks);
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
          console.log(offset)
          return items;
        }
      } else if (!data.body.next) {
        console.log(offset, "early")
        return items;
      }
    } catch (err) {
      if (err.statusCode == 429) {
        console.log(`Error ${err.statusCode}: Rate limit exceeded with number ${offset} call`)
      } else {
        console.log('Something went wrong!', err);
      }
      return items;
    }
  }
}


// Requests all of the saved tracks for a user
async function getUserSavedTracks(api) {
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
  const tracks = playlistTracks.map(pt => pt?.track).filter(t=>t != null);
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


async function getTrackFeatures(api, trackIds) {
  // limit 100 -> songIDs at a time
  return await getNextUntilDone(offset => api.getAudioFeaturesForTracks(
      trackIds.slice(offset * 100, (offset + 1) * 100)),
      "audio_features",
      Math.ceil(trackIds.length / 100)
  );
}

// function mergeTracksWithFeatures(tracks, audioFeatures) {
  // const trackDict = objectListToDictById(tracks);
  // audioFeatures.map(a => {
  //   const track = trackDict[]
  //   const newValue = {
  //     ...a,
  //     ...trackList
  //   }
  //   return a;
  // });
// }



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
    api.setAccessToken(token);
    // Get the authenticated user
    const info = await getSpotifyInfo(api);
    res.send(
      `<html>
      <head>
      </head>
    <body>
     <div>
        <div id="login">
         <h1>Success! </h1>
         <p> Your username is ${info?.user.id} </p>
         <p> Your name is ${info?.user.display_name} </p>
         <a href="/login">Get new token</a>
        </div>
        <script>
        console.log(${JSON.stringify(info?.user)});
        console.info("User playlists");
        console.log(${JSON.stringify(info?.userPlaylists)});
        console.info("save");
        console.log(${JSON.stringify(info?.savedTracks)});
        console.info("playlist tracks");
        console.log(${JSON.stringify(info?.tracks)});
        console.info("audioFeatures");
        console.log(${JSON.stringify(info?.audioFeatures)});
        </script>
     </div>
    </body>
    </html>`);
  } else {
    res.send(
      `<html>
      <head>
      </head>
    <body>
     <div>
        <div id="login">
         <h1>Could not log in. Try to log in again.</h1>
         <a href="/login">Log in</a>
        </div>
     </div>
    </body>
    </html>`);
  }
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
// BQD0lT9kT7zSP51_NZmY3PwvAeCGWkXYfdLXH336bDBfNb2szcA1WEiY1N7BKXlbuOUzs