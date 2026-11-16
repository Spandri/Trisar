-- OSRM-Profil fuer Gleise (Dienstreise, 13.11.2026): Strecke eines Zugs zwischen seinen Halten
-- entlang der echten Schienen. Nur Fern-/Regionalbahn und S-Bahn (railway=rail, light_rail),
-- keine Strassenbahn und U-Bahn. Gebaut mit werkzeuge/schienennetz-bauen.sh.
--
-- Zuege biegen nicht ab wie Autos: scharfe Winkel an Weichen bekommen eine hohe Strafe, Wenden geht
-- nur an einem Halt (Kopfbahnhof). Die Halte gibt train-validate als Zwischenziele vor, dort darf
-- gewendet werden (continue_straight=false in der Abfrage).

api_version = 4

function setup()
  return {
    properties = {
      weight_name = 'duration',
      max_speed_for_map_matching = 300 / 3.6,
      use_turn_restrictions = false,
      continue_straight_at_waypoint = false,
      left_hand_driving = false,
      u_turn_penalty = 1200, -- OSRM speichert Abbiege-Strafen nur bis ca. 3276 s
    },
    default_mode = mode.train,
    default_speed = 100,
  }
end

function process_node(profile, node, result)
end

function process_way(profile, way, result)
  local railway = way:get_value_by_key('railway')
  if railway ~= 'rail' and railway ~= 'light_rail' and railway ~= 'narrow_gauge' then
    return
  end
  local service = way:get_value_by_key('service')
  local usage = way:get_value_by_key('usage')

  -- Grundtempo nach Art der Strecke, Nebengleise langsam, damit die Route auf den Hauptgleisen bleibt.
  local speed = 100
  if usage == 'main' then speed = 160 elseif usage == 'branch' then speed = 80 end
  local maxspeed = tonumber(way:get_value_by_key('maxspeed') or '')
  if maxspeed and maxspeed > 0 then speed = math.min(maxspeed, 300) end
  if service == 'yard' then speed = 5
  elseif service == 'siding' or service == 'spur' then speed = 20
  elseif service == 'crossover' then speed = 40 end

  result.forward_mode = mode.train
  result.backward_mode = mode.train
  result.forward_speed = speed
  result.backward_speed = speed
  result.name = way:get_value_by_key('name') or ''
end

function process_turn(profile, turn)
  local winkel = math.abs(turn.angle)
  -- Weichen haben flache Winkel. Alles ueber 40 Grad ist kein Weg, den ein Zug faehrt.
  if winkel > 40 then
    turn.duration = turn.duration + 600
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
