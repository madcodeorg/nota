import type { OnboardingBlockOption } from '../types';

export const article1: Array<OnboardingBlockOption> = [
  {
    children: <h1>Your local workspace</h1>,
    offset: { x: -400, y: 0 },
  },
  {
    bg: '#DFF4E8',
    children: (
      <>
        <h2>Keep useful context together</h2>
        <p>
          A workspace can hold project plans, reference notes, and daily
          thoughts. Start with a few documents and use names that make sense to
          you.
        </p>
      </>
    ),
    offset: { x: -400, y: 50 },
  },
  {
    bg: '#E1EFFF',
    children: (
      <>
        <h2>Work at your own pace</h2>
        <p>
          The local workspace keeps your notes on this device. You can write and
          organize documents while offline.
        </p>
      </>
    ),
    offset: { x: 430, y: -160 },
  },
  {
    bg: '#F3F0FF',
    children: (
      <>
        <h2>Connect related notes</h2>
        <p>
          Link a project note to the references behind it. In this example, a
          garden plan links to a watering checklist and a list of plants to
          compare.
        </p>
      </>
    ),
    offset: { x: -360, y: 0 },
  },
  {
    bg: '#FFEACA',
    children: <p>Project plan → Reference notes → Next steps</p>,
    edgelessOnly: true,
    position: { x: 500, y: 500 },
    fromPosition: { x: 1000, y: -200 },
    enterDelay: 200,
    style: { width: 350 },
  },
];
