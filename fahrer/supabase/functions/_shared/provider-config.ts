export const providerConfig = {
  lufthansa: {
    clientIdEnvKey: 'LH_CLIENT_ID',
    clientSecretEnvKey: 'LH_CLIENT_SECRET',
    tokenUrl: 'https://api.lufthansa.com/v1/oauth/token',
    flightStatusBaseUrl: 'https://api.lufthansa.com/v1/operations/flightstatus',
  },
  aviationstack: {
    envKey: 'AVIATIONSTACK_API_KEY',
    url: 'https://api.aviationstack.com/v1/flights',
  },
  hexdb: {
    apiBaseUrl: 'https://hexdb.io/api/v1',
  },
  openSky: {
    statesUrl: 'https://opensky-network.org/api/states/all',
    tracksUrl: 'https://opensky-network.org/api/tracks/all',
    tokenUrl: 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    clientIdEnvKey: 'OPENSKY_CLIENT_ID',
    clientSecretEnvKey: 'OPENSKY_CLIENT_SECRET',
  },
  googlePlaces: {
    envKey: 'GOOGLE_PLACES_SERVER_KEY',
    url: 'https://maps.googleapis.com/maps/api/place/autocomplete/json',
  },
  googleRoutes: {
    envKey: 'GOOGLE_ROUTES_SERVER_KEY',
    url: 'https://maps.googleapis.com/maps/api/directions/json',
  },
} as const;
