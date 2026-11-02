import React from 'react';

const Header = ({ title }) => (
  <header className="w-full px-6 py-4 bg-black text-white border-b border-[#222224]">
    <h1 className="text-lg font-black tracking-tight">{title}</h1>
  </header>
);

export default Header;
