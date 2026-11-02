export default function TrisarFooter({ className = 'absolute left-0 right-0 top-[834px] h-10 bg-black', style }) {
  return (
    <footer className={`${className} flex items-center justify-between`} style={style}>
      <div className="w-[116px] text-[#e3f654] text-[10px] tracking-[-0.5px] font-medium text-center leading-[19px]">
        © impressum
      </div>
      <div className="w-[73px] h-[10.83px] shrink-0">
        <img src={'/icon/_Icon_Schwarz/trisar_logo.svg'} alt="trisar" className="w-full h-full object-contain" />
      </div>
      <div className="w-[116px] text-[#e3f654] text-[10px] tracking-[-0.5px] font-medium text-center leading-[19px]">
        support
      </div>
    </footer>
  );
}
