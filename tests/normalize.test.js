const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

for (const name of ['createPost', 'addComment', 'createOrder', 'adminApi']) {
  const { normalizeText, matchWord } = require('../cloudfunctions/' + name + '/lib/normalize')
  describe('normalize.test.js · ' + name, () => {
    it('空白、全角和零宽字符', () => {
      assert.equal(normalizeText('　Ａ\tＢ\u200bＣ\u200f１２３！\uFEFF'), 'abc123!')
      assert.equal(matchWord('代 发 票', ['代发票']), '代发票')
      assert.equal(matchWord('代发票１', ['代发票']), '代发票')
    })
    it('中英混合匹配且返回原词', () => {
      assert.equal(matchWord('；ＤＡＩ发票', ['其它', 'Dai 发票']), 'Dai 发票')
      assert.equal(matchWord('ＤＡＩ发票', ['代发票']), '')
    })
    it('空值和归一化后为空的词不会误拦', () => {
      assert.equal(normalizeText(null), '')
      assert.equal(matchWord('', ['词']), '')
      assert.equal(matchWord('今天食堂排队好久', [null, '', '\u200b', '代发票']), '')
    })
  })
}
