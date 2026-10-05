import type { OnboardingBlockOption } from '../types';

export const article4: Array<OnboardingBlockOption> = [
  {
    children: <h1>Turn a discussion into a plan</h1>,
    offset: { x: -400, y: 0 },
  },
  {
    bg: '#DFF4E8',
    children: (
      <>
        <h2>Keep the context</h2>
        <p>
          Use a note to collect the topic, decisions, and open questions from a
          discussion. For this example, two people are planning the garden
          together.
        </p>
      </>
    ),
    offset: { x: -400, y: 50 },
  },
  {
    bg: '#E1EFFF',
    children: (
      <>
        <h2>Separate decisions from questions</h2>
        <p>
          The decision is to start with containers. The open question is which
          plants fit the light available on the balcony.
        </p>
      </>
    ),
    offset: { x: 430, y: -160 },
  },
  {
    bg: '#F3F0FF',
    children: (
      <>
        <h2>Write down the follow-up</h2>
        <p>
          Add an owner and a next step for each action. One person measures the
          balcony; the other compares container sizes.
        </p>
      </>
    ),
    offset: { x: -360, y: 0 },
  },
  {
    bg: '#FFEACA',
    children: <p>Decision: start small. Follow-up: measure and compare.</p>,
    edgelessOnly: true,
    position: { x: 500, y: 500 },
    fromPosition: { x: 1000, y: -200 },
    enterDelay: 200,
    style: { width: 350 },
  },
];
