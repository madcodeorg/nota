import type { OnboardingBlockOption } from '../types';

export const article2: Array<OnboardingBlockOption> = [
  {
    children: <h1>Learn with your notes</h1>,
    offset: { x: -400, y: 0 },
  },
  {
    bg: '#DFF4E8',
    children: (
      <>
        <h2>Write a question</h2>
        <p>
          Begin with something you want to understand. For this example: which
          plants will grow well in a shaded corner of the garden?
        </p>
      </>
    ),
    offset: { x: -400, y: 50 },
  },
  {
    bg: '#E1EFFF',
    children: (
      <>
        <h2>Keep your observations</h2>
        <p>
          Create a short note after each reading or experiment. Record what you
          noticed and which questions remain open.
        </p>
      </>
    ),
    offset: { x: 430, y: -160 },
  },
  {
    bg: '#F3F0FF',
    children: (
      <>
        <h2>Review and revise</h2>
        <p>
          Return to the notes when you have new information. Update the plan,
          explain your reasoning, and keep the useful references nearby.
        </p>
      </>
    ),
    offset: { x: -360, y: 0 },
  },
  {
    bg: '#FFEACA',
    children: <p>Question → Observation → Revised plan</p>,
    edgelessOnly: true,
    position: { x: 500, y: 500 },
    fromPosition: { x: 1000, y: -200 },
    enterDelay: 200,
    style: { width: 350 },
  },
];
