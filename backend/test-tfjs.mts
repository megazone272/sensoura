import './src/ai/util-shim.js';
import * as tfAll from '@tensorflow/tfjs-node';
const tf = tfAll as unknown as typeof import('@tensorflow/tfjs-node');

const x = tf.tensor1d([1, 2, 3, 4, 5]);
const s = x.slice(1, 3);
console.log('slice ok:', Array.from(s.dataSync()));
s.dispose();
x.dispose();

const y = tf.tensor2d([[1, 2], [3, 4]]);
const z = y.matMul(y);
console.log('matMul ok:', Array.from(z.dataSync()));
z.dispose();
y.dispose();

const model = tf.sequential();
model.add(tf.layers.dense({ units: 1, inputShape: [2] }));
const out = model.predict(tf.tensor2d([[1, 2]]));
console.log('dense predict ok:', Array.from(out.dataSync()));
out.dispose();

console.log('ALL TFJS TESTS PASSED');
process.exit(0);
