const  params = [
  { name: 'period', min: 5, max: 200, def: 10, value: null, elems: null },
  { name: 'duration', min: 1, max: 200, def: 100, value: null, elems: null },
  { name: 'blur', min: 1, max: 200, def: 3, value: null, elems: null },
  { name: 'pitch', min: -1200, max: 1200, def: 0, value: null, elems: null },
  { name: 'bubble', min: 0, max: 1200, def: 0, value: null, elems: null },
  { name: 'gain', min: -40, max: 20, def: 0, value: null, elems: null },
  { name: 'attack', min: 0, max: 50, def: 50, value: null, elems: null },
  { name: 'release', min: 0, max: 50, def: 50, value: null, elems: null }
];

export default params;
