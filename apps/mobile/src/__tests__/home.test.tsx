import { render, screen } from "@testing-library/react-native";

import HomeScreen from "../app/index";

test("home screen renders the app name", async () => {
  await render(<HomeScreen />);
  expect(await screen.findByText("Reading Companion")).toBeTruthy();
});
