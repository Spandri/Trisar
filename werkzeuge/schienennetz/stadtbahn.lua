-- OSRM-Profil fuer U-Bahn und Tram (Dienstreise, 14.11.2026): Linie eines Abschnitts mit U-Bahn oder
-- Strassenbahn entlang der Gleise. Nur railway=subway, tram, light_rail (light_rail zaehlt zur U-Bahn). Gebaut mit
-- werkzeuge/stadtbahn-bauen.sh, Container trisar-osrm-stadtbahn (Port 5003).
-- Anders als bei schiene.lua gibt es keine Zwischenhalte, darum nur maessige Strafen fuer scharfe Winkel.

api_version = 4

function setup()
  return {
    properties = {
      weight_name = 'duration',
      max_speed_for_map_matching = 100 / 3.6,
      use_turn_restrictions = false,
      continue_straight_at_waypoint = true,
      left_hand_driving = false,
      u_turn_penalty = 1200,
    },
    default_mode = mode.train,
    default_speed = 40,
    -- U-Bahn und Tram getrennt abfragbar (exclude=tram bzw. exclude=subway), sonst springt die Route
    -- am Hauptbahnhof von der U-Bahn auf die Tram-Gleise darueber.
    classes = { 'subway', 'tram' },
    excludable = { { tram = true }, { subway = true } },
  }
end

function process_node(profile, node, result)
end

function process_way(profile, way, result)
  local railway = way:get_value_by_key('railway')
  if railway ~= 'subway' and railway ~= 'tram' and railway ~= 'light_rail' then
    return
  end
  local service = way:get_value_by_key('service')
  local speed = 50
  if railway == 'tram' then speed = 30 end
  if service == 'yard' or service == 'siding' or service == 'spur' then speed = 5 end
  result.forward_mode = mode.train
  result.backward_mode = mode.train
  result.forward_speed = speed
  result.backward_speed = speed
  result.name = way:get_value_by_key('name') or ''
  local klasse = railway == 'tram' and 'tram' or 'subway'
  result.forward_classes[klasse] = true
  result.backward_classes[klasse] = true
end

function process_turn(profile, turn)
  if math.abs(turn.angle) > 60 then
    turn.duration = turn.duration + 300
  end
  if turn.is_u_turn then
    turn.duration = turn.duration + profile.properties.u_turn_penalty
  end
  turn.weight = turn.duration
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn,
}
