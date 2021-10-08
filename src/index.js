const express = require('express')
const app = express()
const port = 3000
// http://localhost:3000/
// copy the code
// http://localhost:3000/sync?code=BQD8NfP72SvvsqpxaOkIKspYbgt-FxhxmvqvfoyEGKm5xXEvpsuv3rTx_SOkwlWXw9aQz-xM_Vg60kfH9VDCRwKlgdkBPSUDA7ppskZOBBz6dhY1DHFISEbuEyuCG-iShjFTA-ELFn6Tbp_TKr1BDeNbuNUKqRh9GAIOIJr0
const my_client_id = '5dd2dda670184f4688b9eef425c31877';
const redirectURL = encodeURIComponent("http://localhost:3000/callback");
// serve the html
app.use(express.static('public'))
app.get('/login', function(req, res) {
  var scopes = 'user-read-private user-read-email playlist-read-private';
  res.redirect(`https://accounts.spotify.com/authorize?client_id=${my_client_id}&redirect_uri=${redirectURL}&response_type=token&state=123&scope=${scopes}`);
});


const SpotifyWebApi = require('spotify-web-api-node');

async function startSyncing() {
  const userInfo = await getUserInfo();
  if (!userInfo) return;
  const username = userInfo.id;
  const userPlaylists = await getUserPlaylists(username);
  console.log(userPlaylists);
}
async function getUserInfo() {
  try {
    const data = await spotifyApi.getMe()
    console.log('Some information about the authenticated user', data.body);
    return data.body;
  } catch (err) {
    console.log('Something went wrong!', err);
    return undefined;
  }
}
async function getUserPlaylists(username) {
  try {
    const data = await spotifyApi.getUserPlaylists(username)
    console.log('Retrieved playlists', data.body);
    return data.body;
  } catch (err) {
    console.log('Something went wrong!', err);
    return undefined;
  }
}

// credentials are optional
var spotifyApi = new SpotifyWebApi({
  clientId: my_client_id,
  // clientSecret: 'adfc1015524244db90719df32605b7a4',
  redirectUri: 'http://localhost:3000/callback'
});

app.get('/sync', (req, res) => {
  // starts syncing the spotify data into firebase
  const token = req.query.code;
  if (token) {

    spotifyApi.setAccessToken(token);
    // Get the authenticated user
    startSyncing();

  }
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})
// BQD0lT9kT7zSP51_NZmY3PwvAeCGWkXYfdLXH336bDBfNb2szcA1WEiY1N7BKXlbuOUzs