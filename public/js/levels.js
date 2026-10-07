// Campaign mission definitions, easiest first. Endless mode (endless.js) builds random
// variations of these five. All positions are in meters on the "target plane":
// x = horizontal (0 = scene center), y = height above the ground.
//
// wind: { base, gust } in mph; positive = blowing toward the right (coming FROM the left).
// people[].move: optional walk pattern { from, to, speed (m/s), pause (s), phase (s) }.
// weather: 'clear' | 'rain' | 'snow' | 'fog' | 'heat' (fog and heat knock out the rangefinder).
// train: optional { speed (m/s), cars, carLength, floorY, windows } - passengers ride in it.

import { dossierLine } from './world.js';

// Outfits fit the setting: hunting gear in the field, work clothes on the farm, parkas in the
// winter market, suits on the rooftop and the train. The dossier line is built from the same
// words the sniper uses to describe people, so they always match.
const DRESS = {
  hunter: { style: 'jacket', coat: '#556b2f', shirt: '#556b2f', pants: '#3b4a63', skin: '#d9a77c', hair: '#2a1d14', glasses: true, hat: '#e8670c', hatStyle: 'cap' },
  rancher: { style: 'jacket', coat: '#9b1c1c', shirt: '#9b1c1c', pants: '#3b4a63', skin: '#d9a77c', hair: '#2a1d14', glasses: true, hat: '#16161a', hatStyle: 'brim' },
  parka: { style: 'parka', coat: '#1c2a4a', pants: '#2c2c34', skin: '#d9a77c', hair: '#2a1d14', glasses: true, scarf: '#d01818', hat: '#7c7f86', hatStyle: 'beanie' },
};
const overalls = (shirt, extra = {}) => ({ style: 'overalls', shirt, coat: shirt, pants: '#3d5a80', skin: extra.skin || '#e0b58f', hair: extra.hair || '#3a2a1a', ...extra });
const parka = (coat, extra = {}) => ({ style: 'parka', coat, pants: '#2c2c34', skin: extra.skin || '#e0b58f', hair: extra.hair || '#3a2a1a', ...extra });

export const SUIT = {
  target: { style: 'suit', coat: '#16161a', shirt: '#f2f2f2', tie: '#d01818', pants: '#16161a', skin: '#d9a77c', hair: '#2a1d14', glasses: true },
};

export const civ = (coat, pants, extra = {}) => ({ coat, shirt: extra.shirt || coat, tie: null, pants, skin: extra.skin || '#e0b58f', hair: extra.hair || '#3a2a1a', ...extra });

export const LEVELS = [
  {
    id: 'field',
    weather: 'clear',
    scene: 'Dawn. You and Ghost lie side by side in the tall grass on a ridge above an empty field. Your binoculars are up; Ghost is behind the rifle, waiting for your word.',
    name: 'Open Field',
    codename: 'OPERATION DAYBREAK',
    difficulty: 'Recruit',
    distance: 300,
    tempF: 59,
    wind: { base: 0, gust: 0 },
    rangefinder: true,
    timeLimit: 90,
    viewMils: 40,
    camera: { x: 0, y: 2 },
    sky: 'day',
    ground: '#6f9a45',
    intel: 'Target is alone in the middle of the field. No civilians. Calm air.',
    tutorial: [
      'Say the target number: "Target one."',
      'Give the sniper the range from your rangefinder: "Range three hundred."',
      'Then give the order: "Send it!" (or "Fire!")',
    ],
    target: {
      name: 'Viktor "The Viper" Kovac',
      description: dossierLine(DRESS.hunter, 'hat'),
      lines: ['This field is perfect. Nobody will find us out here.', 'Where is my driver? I do not like waiting.'],
    },
    people: [{ x: 0, outfit: DRESS.hunter, isTarget: true }],
    props: [
      { type: 'hills', color: '#7d9a6a' },
      { type: 'tree', x: -14, h: 9 }, { type: 'tree', x: 13, h: 11 }, { type: 'tree', x: 17, h: 7 },
      { type: 'fence', from: -20, to: -6 }, { type: 'fence', from: 6, to: 20 },
      { type: 'flag', x: 7 },
      { type: 'rock', x: -4, w: 1.2 },
    ],
  },
  {
    id: 'farm',
    weather: 'clear',
    scene: 'Late morning on a quiet farm. You are both dug in behind a hedgerow. The wind is rattling the orange marker flag by the fence - use it.',
    name: 'The Farmhouse',
    codename: 'OPERATION HAYSTACK',
    difficulty: 'Easy',
    distance: 450,
    tempF: 75,
    wind: { base: -6, gust: 0.6 },
    rangefinder: true,
    timeLimit: 75,
    viewMils: 45,
    camera: { x: 0, y: 3 },
    sky: 'day',
    ground: '#8aa04a',
    intel: 'Target is meeting two farmhands. Wind is picking up - call it. Do NOT hit the civilians.',
    tutorial: [
      'Identify the right person first - check the description.',
      'Call the wind from the wind meter: "Wind six from the right."',
      'Then range and "Send it."',
    ],
    target: {
      name: 'Viktor "The Viper" Kovac',
      description: `${dossierLine(DRESS.rancher, 'hat')} (The farmhands wear overalls.)`,
      lines: ['The shipment arrives tonight. Keep the barn locked.', 'Smile, gentlemen. Business is good.'],
    },
    people: [
      { x: -3.2, outfit: overalls('#c0392b', { hat: '#b8945a', hatStyle: 'brim' }) },
      { x: 0.4, outfit: DRESS.rancher, isTarget: true },
      { x: 3.6, outfit: overalls('#e9e4d4', { hat: '#5a3e2b', hatStyle: 'cap' }) },
    ],
    props: [
      { type: 'hills', color: '#8fa36f' },
      { type: 'barn', x: -15, w: 10, h: 8 },
      { type: 'house', x: 13, w: 9, h: 7 },
      { type: 'tree', x: 22, h: 10 }, { type: 'tree', x: -24, h: 9 },
      { type: 'fence', from: -8, to: 8 },
      { type: 'flag', x: 7.5 },
      { type: 'hay', x: -8, w: 1.6 }, { type: 'hay', x: -6.2, w: 1.6 },
    ],
  },
  {
    id: 'market',
    weather: 'snow',
    scene: 'A frozen market square. Snow is falling and your breath fogs the glass. Ghost is tucked into a bell tower beside you, rifle resting on the ledge.',
    name: 'Winter Market',
    codename: 'OPERATION COLD SNAP',
    difficulty: 'Medium',
    distance: 600,
    tempF: 15,
    wind: { base: 9, gust: 3 },
    rangefinder: true,
    timeLimit: 60,
    viewMils: 50,
    camera: { x: 0, y: 4 },
    sky: 'winter',
    ground: '#e8eef2',
    snow: true,
    intel: 'Freezing cold air means more bullet drop - call the temperature. The target walks the market and stops at the stalls. Watch for a bodyguard in the same parka.',
    tutorial: [
      'Call the temperature: "Temperature fifteen."',
      'Gusty wind - read the meter right before you call it.',
      'Fire while he stands still, or call his speed: "Moving at one."',
    ],
    target: {
      name: 'Viktor "The Viper" Kovac',
      description: `${dossierLine(DRESS.parka, 'scarf')} (His bodyguard wears the same parka with a blue scarf.)`,
      lines: ['It is so cold my coffee froze. Hurry up with the exchange.', 'Keep your eyes open. I hear a sniper is in town.'],
    },
    people: [
      { x: -8, outfit: parka('#c0392b', { hat: '#ecf0f1', hatStyle: 'beanie' }), move: { from: -11, to: -2, speed: 0.7, pause: 2, phase: 0 } },
      { x: -2, outfit: DRESS.parka, isTarget: true, move: { from: -5, to: 4, speed: 0.9, pause: 4, phase: 1.5 } },
      { x: 2, outfit: { ...DRESS.parka, scarf: '#1d4ed8', glasses: false, skin: '#b07d56' }, move: { from: -3, to: 6, speed: 0.9, pause: 4, phase: 0.2 } },
      { x: 7, outfit: parka('#27ae60', { hat: '#c0392b', hatStyle: 'beanie', scarf: '#ecf0f1' }), move: { from: 4, to: 11, speed: 0.6, pause: 3, phase: 2 } },
      { x: 10, outfit: parka('#8e44ad', { hair: '#d4a017' }) },
    ],
    props: [
      { type: 'buildings', color: '#8d8f9a', y: 0 },
      { type: 'stall', x: -9, w: 4, color: '#c0392b' },
      { type: 'stall', x: 0, w: 4, color: '#2980b9' },
      { type: 'stall', x: 9, w: 4, color: '#f39c12' },
      { type: 'lamp', x: -4.5 }, { type: 'lamp', x: 4.5 },
      { type: 'flag', x: -13 }, { type: 'flag', x: 13.5 },
    ],
  },
  {
    id: 'rooftop',
    weather: 'heat',
    scene: 'Sunset after a scorching day. Heat shimmer is boiling off the rooftops and has blinded the laser rangefinder. You will have to measure the range yourself.',
    name: 'Rooftop Rendezvous',
    codename: 'OPERATION SKYLINE',
    difficulty: 'Hard',
    distance: 800,
    tempF: 95,
    wind: { base: -11, gust: 3 },
    rangefinder: false,
    timeLimit: 60,
    viewMils: 50,
    camera: { x: 0, y: 11 },
    sky: 'dusk',
    ground: '#5a5048',
    intel: 'Rangefinder is OFFLINE (heat haze). Estimate range with the mil grid: Range (m) = size (m) x 1000 / size (mils). People are about 1.75 m tall; the water tower is 6 m tall. Hot air = less drop.',
    tutorial: [
      'Measure the water tower (6 m) or a person (1.75 m) in mils on the grid.',
      'Range = meters x 1000 / mils. Example: 6 m / 7.5 mils = 800 m.',
      'Hot air: call the temperature. Strong gusty wind: call it last.',
    ],
    target: {
      name: 'Viktor "The Viper" Kovac',
      description: dossierLine(SUIT.target, 'tie'),
      lines: ['The helicopter lands in ten minutes. Nobody leaves this roof.', 'This heat is unbearable. Get me some water.'],
    },
    roofY: 12,
    people: [
      { x: -5, y: 12, outfit: civ('#2d3436', '#2d3436', { shirt: '#636e72', glasses: true }) },
      { x: -1, y: 12, outfit: SUIT.target, isTarget: true, move: { from: -3, to: 3, speed: 0.6, pause: 5, phase: 3 } },
      { x: 3.5, y: 12, outfit: civ('#dfe6e9', '#2d3436', { shirt: '#dfe6e9', hair: '#b2bec3' }) },
      { x: 6, y: 12, outfit: civ('#6c5ce7', '#2d3436'), move: { from: 4.5, to: 8, speed: 0.5, pause: 3, phase: 0 } },
    ],
    props: [
      { type: 'skyline', color: '#3d3550' },
      { type: 'tower', x: 0, w: 30, h: 12, color: '#6b5b52' },
      { type: 'watertower', x: -11, h: 6, baseY: 12 },
      { type: 'tower', x: -30, w: 10, h: 18, color: '#574a45' },
      { type: 'tower', x: 28, w: 12, h: 16, color: '#4e423d' },
      { type: 'flag', x: 10, baseY: 12 },
    ],
  },
  {
    id: 'train',
    weather: 'rain',
    scene: 'Midnight, rain hammering the hillside. A lit passenger train circles the valley below you. Ghost has the rifle on its bipod in the mud next to you. He only gets a few seconds per pass.',
    name: 'The Midnight Express',
    codename: 'OPERATION IRON HORSE',
    difficulty: 'Expert',
    distance: 450,
    tempF: 48,
    wind: { base: 5, gust: 2 },
    rangefinder: true,
    timeLimit: 70,
    viewMils: 50,
    camera: { x: 0, y: 3 },
    sky: 'night',
    ground: '#2b3326',
    intel: 'The target is on a moving train that keeps circling the valley. Intel: train speed about 4 m/s, moving right. Call his speed so the sniper leads him. Use "Fire when ready" so the sniper takes the shot the moment the window is clear.',
    tutorial: [
      'Set up the whole solution while the train is out of view.',
      'Call the lead: "Moving at four."',
      'Say "Fire when ready" - the sniper shoots when the target passes the center.',
    ],
    target: {
      name: 'Viktor "The Viper" Kovac',
      description: `${dossierLine(SUIT.target, 'tie')} Riding in the second passenger car.`,
      lines: ['Nobody can hit a moving train. I am untouchable.', 'Conductor! More champagne!'],
    },
    train: { speed: 4, carLength: 13, gap: 1, cars: 3, floorY: 1.1, windowBottom: 0.95, windowTop: 1.9, windowWidth: 1.5, windowsPerCar: 4 },
    // Passengers: car index + window index. People sit/stand at the window.
    people: [
      { car: 0, window: 1, outfit: civ('#a0522d', '#333', { hat: '#222' }) },
      { car: 0, window: 3, outfit: civ('#4682b4', '#333') },
      { car: 1, window: 0, outfit: civ('#556b2f', '#333', { hair: '#888' }) },
      { car: 1, window: 2, outfit: SUIT.target, isTarget: true },
      { car: 1, window: 3, outfit: { ...SUIT.target, tie: '#1d4ed8', glasses: false } },
      { car: 2, window: 1, outfit: civ('#b03060', '#333', { hair: '#d4a017' }) },
      { car: 2, window: 2, outfit: civ('#708090', '#333') },
    ],
    props: [
      { type: 'mountains', color: '#1b2233' },
      { type: 'moon', x: 14, y: 16 },
      { type: 'tracks' },
      { type: 'pole', x: -10 }, { type: 'pole', x: 10 },
      { type: 'flag', x: -16 },
    ],
  },
];
