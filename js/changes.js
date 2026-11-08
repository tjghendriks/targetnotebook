// What's new: a short, plain-English history for the people using the app.
// Newest first. Add an entry when a release changes something people will
// notice; its `id` is what lights up the What's new button, so give each
// entry a new one (the release date is fine). Releases with nothing to tell
// need no entry and do not light the button.
//
// `major` lists the big new features, shown first and highlighted; `items`
// lists the smaller changes and fixes after them. Either may be left out.

export const CHANGES = [
  {
    id: '2026-11-08-skirmisher',
    date: '8 November 2026',
    major: [
      'Skirmisher scanning added.',
    ],
    items: [
      'This What\'s new list. The button lights up when there is something new to read.',
      'My Setup fields take any text, so handstop, sling, foresight and spacers no longer have to be numbers.',
      'On a card, the way back to the Dashboard stays at the top as you scroll.',
      'Add new and My Setup stay at the top of the Dashboard as you scroll.',
      'Shot order on a card folds away until you need it.',
      'Shorter notices: shots to check are simply drawn pale and dashed, and a shot right on a line is named.',
      'A new scan shows "Card was upside down" right under the card.',
      'Competition suggestions are clearer to tap.',
    ],
  },
  {
    id: '2026-10-17',
    date: '17 October 2026',
    major: [
      'Analysis can use a set number of cards, a date range, or cards you pick.',
      'Cross-shots are scored, with the penalty under rule 5.2.1.',
    ],
    items: [
      'Competition names are suggested for the time of year.',
      'Better shot finding on photos taken on wooden desks.',
    ],
  },
  {
    id: '2026-10-13',
    date: '13 October 2026',
    major: [
      'Training notes, and notes on each card.',
    ],
    items: [
      'A left or right-handed setting.',
    ],
  },
  {
    id: '2026-10-12',
    date: '12 October 2026',
    major: [
      'My Setup: keep your rifle\'s settings and photos of its set-up.',
    ],
    items: [
      'The Cards screen is now the Dashboard, with cards grouped by date.',
      '2510 outer scoring: 5 within the black, 4 breaking its edge.',
    ],
  },
  {
    id: '2026-10-11',
    date: '11 October 2026',
    major: [
      'Target Notebook gets its new name and look.',
      '2505CS 5-bull cards.',
      'Analysis shows your average, NSRA average and last 5, and the points lost at each position on the card.',
    ],
    items: [
      'Choose the shot order by tapping a picture of the card.',
      'The score waits until every shot is accounted for.',
    ],
  },
];
