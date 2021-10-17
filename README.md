# Symphony -- Overview
Symphony is a web app that takes spotify playlists and allows you to perform different set operations on them to create new 'smart playlists'. It is a node/react app so it can be started by running npm start in the root folder of either the web service or the client. Running the web service will give you a testing page that we used for managing the data we received from Spotify's API. Running the client will pull up the frontend of the application. Both are run on localHost 3000 so they cannot run at the same time. We are dynamically generating the frontend based off of the song data that we receive. The data also influences what is seen on the smart playlist page. 

The application isn't fully complete on the frontend, there are still quite a few empty pages but we plan on continuing the project.

# Demo Video
[Symphony Web App](https://youtu.be/4l9MDJdJoYs)

# Web Pages
There are two main pages that have been worked on, the home page and the smart playlist page. The list of songs on the home page are dynamically generated based off of Spotify data stored in Firebase. The smart playlist page is also influenced by this data.

# Development Environment
* Visual Studio Code
* Firebase
* Spotfy API

## Languages/Frameworks
* node.js
* React

## Libraries
* ExpressJS

# Useful Websites

* [Stack Overflow](https://stackoverflow.com/)
* [Spotify API Documentation](https://developer.spotify.com/documentation/web-api/)

# Future Work

* Finish frontend for smart playlist, search, and tags sections
* Testing data integrity from spotify
* The ability to send new smart playlists back to spotify
