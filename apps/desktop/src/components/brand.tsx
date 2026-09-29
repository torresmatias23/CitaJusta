import logo from '../assets/logo-citajusta.png';

export function Brand({ hero = false }: { hero?: boolean }) {
  return <span className={`official-brand${hero ? ' official-brand-hero' : ''}`}>
    <img src={logo} alt="CitaJusta" width={2000} height={2000} />
  </span>;
}
