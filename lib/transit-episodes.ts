export function startsNewTransitEpisode(
  previous: { date: string; barIndex: number },
  current: { date: string; barIndex: number },
) {
  const calendarGap = (
    new Date(`${current.date}T01:00:00Z`).getTime() -
    new Date(`${previous.date}T01:00:00Z`).getTime()
  ) / 86_400_000;
  return current.barIndex !== previous.barIndex + 1 || calendarGap > 14;
}
