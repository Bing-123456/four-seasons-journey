'use strict';

// Each fruit has an individual portrait file under assets/fruit-art, split
// from the former per-season atlases. Labels remain native text; these images
// are illustrations, not field photos.
function fruitArt(id) {
  if (!id) return null;
  return {
    src: '/assets/fruit-art/' + id + '.jpg',
    style: ''
  };
}

module.exports = { fruitArt };
