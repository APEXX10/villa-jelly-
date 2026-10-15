# Villa Jelly.

A fantasy 3D diorama in the browser: a floating island block with a white villa, palm trees and a wobbly, see-through jelly sea — built with [Three.js](https://threejs.org).

## Run

```bash
node server.js
```

Then open http://localhost:5173 (Three.js loads from a CDN, so an internet connection is needed). Any static file server works too.

## What you can do

- **Grab & throw** ducks, balls, crates and rocks — they float, sink, roll and bounce off each other
- **Finger in water** — drag through the jelly to draw waves
- **Big wave, stir, tip, jelly bounce, meteor, magic burst**
- **8 jelly flavours**, **day / sunset / night**, **clear / rain / storm** (with lightning)
- Jumping fish, a boat with a real wake, underwater caustics, optional sound

The sea is a 2D wave-equation heightfield: ripples travel, reflect off the shore and the jelly walls, and interfere. Bodies use buoyancy from their submerged fraction, added mass, drag, friction and sphere collisions.

### Keys

`D` duck · `B` ball · `C` crate · `R` rock · `W` wave · `S` stir · `T` tip · `J` bounce · `X` meteor · `M` magic · `Q` wobble · `1–8` flavour
