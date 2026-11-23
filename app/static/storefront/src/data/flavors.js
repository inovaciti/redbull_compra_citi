// Visual de cada sabor, indexado pelo ID do produto no banco (`products.id`).
//
// Nome, estoque e preço vêm da API; aqui ficam só os dados que o banco não
// guarda: lata 3D, foto da lata, cores e ordem de exibição. A ordem do array é a ordem
// do carrossel e do rodízio de sabores na geladeira. Produto do banco sem entrada aqui
// aparece no fim, com o visual padrão.
//
// Campos:
//   id         ID do produto no banco
//   model      ID da lata 3D do kit (cooler/latas/<model>/modelo.glb); sem ele, o sabor
//              é vendido normalmente mas não aparece dentro da geladeira
//   image      arquivo em assets/images/cans/ (PNG/WebP com fundo transparente)
//   can        cores do sabor na interface: body (corpo), deep (sombra), accent (faixa)
//   gradient   três tons do degradê do nome do sabor

const image = (file) => new URL(`../../assets/images/cans/${file}`, import.meta.url).href;

export const FLAVOR_VISUALS = [
  {
    id: 'original',
    model: 'original',
    image: image('original.webp'),
    can: { body: '#3A4250', deep: '#1B2029', accent: '#D7DCE3' },
    gradient: ['#A9D0FF', '#5B8FF5', '#3A55D6'],
  },
  {
    id: 'tradicional_sugarfree',
    model: 'sugar-free',
    image: image('sugar-free.webp'),
    can: { body: '#8FD0F2', deep: '#4E9CC8', accent: '#F4FAFE' },
    gradient: ['#E8F8FF', '#8FD0F2', '#3E9BD6'],
  },
  {
    id: 'zero_tradicional',
    model: 'zero',
    image: image('zero.webp'),
    can: { body: '#EEF0F3', deep: '#C3C8CF', accent: '#1A1C20' },
    gradient: ['#F4F8FF', '#B8C8E4', '#7C8FC0'],
  },
  {
    id: 'melancia',
    model: 'summer-melancia',
    image: image('melancia.webp'),
    can: { body: '#E5484D', deep: '#A9222A', accent: '#3DDC84' },
    gradient: ['#FF8FA0', '#E5484D', '#35D07F'],
  },
  {
    id: 'tropical',
    model: 'tropical',
    image: image('tropical.webp'),
    can: { body: '#FFB21E', deep: '#E07E00', accent: '#2BB673' },
    gradient: ['#FFE45C', '#FFB21E', '#FF6A1A'],
  },
  {
    id: 'acai',
    model: 'acai',
    image: image('acai.webp'),
    can: { body: '#5A2B8C', deep: '#2E1049', accent: '#E9A5FF' },
    gradient: ['#F3BCFF', '#B473F2', '#6B34B8'],
  },
  {
    id: 'morango_e_pessego',
    model: 'pessego',
    image: image('morango-pessego.webp'),
    can: { body: '#FF8148', deep: '#D9531D', accent: '#FFC38A' },
    gradient: ['#FF8A7A', '#FF8438', '#FFB45C'],
  },
  {
    id: 'melao_e_maracuja',
    model: 'melao',
    image: image('maracuja-melao.webp'),
    can: { body: '#6FCF4F', deep: '#3A9A2E', accent: '#E8F58A' },
    gradient: ['#E6F58A', '#8EDB52', '#35B866'],
  },
  {
    id: 'maca_sugarfree',
    model: 'maca-sugar-free',
    image: image('maca-sugar-free.webp'),
    can: { body: '#FFC62E', deep: '#E5453A', accent: '#FFF3B0' },
    gradient: ['#FFE35A', '#FFC21F', '#F0483E'],
  },
  {
    id: 'nectarina_sugarfree',
    model: 'nectarina-sugar-free',
    image: image('nectarina-sugar-free.webp'),
    can: { body: '#FF6FAE', deep: '#D8387F', accent: '#FFD3E6' },
    gradient: ['#FFC2DD', '#FF6FAE', '#E83F8F'],
  },
  {
    id: 'pomelo_sugarfree',
    model: 'pomelo-sugar-free',
    image: image('pomelo-sugar-free.webp'),
    can: { body: '#C9A8F5', deep: '#8F6FD6', accent: '#F2E8FF' },
    gradient: ['#EEDFFF', '#C9A8F5', '#9C7FE0'],
  },
  {
    id: 'amora_sugarfree',
    model: 'amora-sugar-free',
    image: image('amora-sugar-free.webp'),
    can: { body: '#EE9AC2', deep: '#CF5C93', accent: '#FFE3F0' },
    gradient: ['#FFE6F2', '#F8B4D4', '#EA83B5'],
  },
];

/** Visual usado por produtos do banco que ainda não têm entrada acima. */
export const DEFAULT_VISUAL = FLAVOR_VISUALS[0];
