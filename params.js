export default [
  { name: 'freeze', def: false },
  { name: 'end', def: false },
  { name: 'period', min: 5, max: 200, def: 10 },
  { name: 'duration', min: 1, max: 200, def: 100 },
  { name: 'blur', min: 1, max: 400, def: 3 },
  { name: 'pitch', min: -1200, max: 1200, def: 0 },
  { name: 'bubble', min: 0, max: 1200, def: 0 },
  { name: 'gain', min: -40, max: 20, def: 0 },
  { name: 'attack', min: 0, max: 50, def: 50 },
  { name: 'release', min: 0, max: 50, def: 50 },
];
