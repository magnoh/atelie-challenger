// Department IDs and medium values accepted by the Metropolitan Collection API.
export const departments = [
  [1, 'Arte decorativa americana', 'American Decorative Arts'],
  [3, 'Arte da Ásia Ocidental antiga', 'Ancient West Asian Art'],
  [4, 'Armas e armaduras', 'Arms and Armor'],
  [5, 'África, Oceania e Américas', 'Arts of Africa, Oceania, and the Americas'],
  [6, 'Arte asiática', 'Asian Art'], [7, 'The Cloisters', 'The Cloisters'],
  [8, 'Moda e vestuário', 'The Costume Institute'], [9, 'Desenhos e gravuras', 'Drawings and Prints'],
  [10, 'Arte egípcia', 'Egyptian Art'], [11, 'Pintura europeia', 'European Paintings'],
  [12, 'Escultura e decoração europeia', 'European Sculpture and Decorative Arts'],
  [13, 'Arte grega e romana', 'Greek and Roman Art'], [14, 'Arte islâmica', 'Islamic Art'],
  [15, 'Coleção Robert Lehman', 'The Robert Lehman Collection'], [16, 'Bibliotecas', 'The Libraries'],
  [17, 'Arte medieval', 'Medieval Art'], [18, 'Instrumentos musicais', 'Musical Instruments'],
  [19, 'Fotografia', 'Photographs'], [21, 'Arte moderna', 'Modern Art'],
].map(([id, label, name]) => ({ id, label, name }));
export const media = [
  ['Paintings', 'Pinturas'], ['Sculpture', 'Esculturas'], ['Ceramics', 'Cerâmicas'],
  ['Drawings', 'Desenhos'], ['Prints', 'Gravuras'], ['Photographs', 'Fotografias'],
  ['Textiles', 'Têxteis'], ['Furniture', 'Mobiliário'],
].map(([value, label]) => ({ value, label }));
