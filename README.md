# Klangfeld

*Klangfeld* is an updated version of the [GrainField](https://github.com/ircam-cosima/grainfield) web application develped by Benjamin Matuszewski and Norbert Schnell at IRCAM ISMM (see [WAC paper](https://hal.science/hal-01580467).

The application usues websockets to connect three web clients:
- the `recorder` client records audio input
- the `player` client load snippets of the recorded audio allowing to play with them throug granular synthesis
- the `controller` client provides a simple user interface to change the synthesis parameters of the players

The server is started by the command `node server.js`.