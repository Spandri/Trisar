import React from 'react';
import { BACK_ICON_URL } from '../../shared/ui/icons';

// Der Zurueck-Knopf oben links — eine einzige Stelle fuer alle Ansichten.
// Massgeblich ist die Fahrzeugansicht: 50 px Kreis mit grauem Rand, darin der
// TRISAR-Pfeil in 26,14 x 15,91. Neue Ansichten nehmen diesen Knopf, damit der
// Pfeil nirgends groesser oder kleiner ausfaellt.
const ZurueckKnopf = ({ onClick, marker, links = 20, oben = 60 }) => (
  <button
    type="button"
    onClick={onClick}
    data-tutorial={marker}
    className="absolute w-[50px] h-[50px]"
    style={{ left: `${links}px`, top: `${oben}px` }}
  >
    <div className="absolute inset-0 rounded-full border border-[#747474]" />
    <img
      src={BACK_ICON_URL}
      alt="back"
      className="absolute left-[12.5px] top-[17.05px] w-[26.14px] h-[15.91px] object-contain rotate-180 scale-[1.2]"
    />
  </button>
);

export default ZurueckKnopf;
