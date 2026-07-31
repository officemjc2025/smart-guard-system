export interface SingleFlightRef<T> {
  current: Promise<T> | null;
}

export async function runSingleFlight<T>(
  flightRef: SingleFlightRef<T>,
  create: () => Promise<T>,
): Promise<T> {
  if (flightRef.current) return flightRef.current;

  const creation = create();
  flightRef.current = creation;

  try {
    return await creation;
  } finally {
    if (flightRef.current === creation) {
      flightRef.current = null;
    }
  }
}
