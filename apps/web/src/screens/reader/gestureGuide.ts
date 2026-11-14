// The hand gestures the camera understands, for the guide in the controls sheet.

/** The hand gestures the camera understands, and what they do. Mirrors cameraGestures.ts. */
export const GESTURE_GUIDE = [
  { icon: "☝️", name: "Point", does: "Moves the highlight to the word under your fingertip" },
  { icon: "🤏", name: "Pinch thumb and index", does: "Select: opens the word card" },
  { icon: "🤞", name: "Pinch thumb and middle", does: "Back: closes the card" },
  {
    icon: "✋",
    name: "Swipe an open palm",
    does: "Left or right: previous or next phrase. Up or down: line",
  },
  {
    icon: "🤘",
    name: "Hold index and little finger out",
    does: "Gives you the gist of the whole page (middle and ring curled, for a second)",
  },
  {
    icon: "🤙",
    name: "Hold thumb and little finger out",
    does: "Shows or hides these controls (other fingers curled, for a second)",
  },
] as const;
