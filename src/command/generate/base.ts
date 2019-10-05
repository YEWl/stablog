import Base from '~/src/command/base'
import http from '~/src/library/http'
import md5 from 'md5'
import url from 'url'
import moment from 'moment'
import _ from 'lodash'
import fs from 'fs'
import path from 'path'
import shelljs from 'shelljs'
import PathConfig from '~/src/config/path'
import DATE_FORMAT from '~/src/constant/date_format'
import CommonUtil from '~/src/library/util/common'
import logger from '~/src/library/logger'
import StringUtil from '~/src/library/util/string'
import Epub from '~/src/library/epub'
import TypeTaskConfig from '~/src/type/namespace/task_config'

class FetchBase extends Base {
  epub: Epub | null = null
  imageQuilty: TypeTaskConfig.imageQuilty = 'hd'

  imgUriPool: Set<string> = new Set()

  bookname = ''

  get epubCachePath() {
    return path.resolve(PathConfig.epubCachePath, this.bookname)
  }

  get epubOutputPath() {
    return path.resolve(PathConfig.epubOutputPath, this.bookname)
  }

  get htmlCachePath() {
    return path.resolve(PathConfig.htmlCachePath, this.bookname)
  }
  get htmlCacheHtmlPath() {
    return path.resolve(this.htmlCachePath, 'html')
  }
  get htmlCacheSingleHtmlPath() {
    return path.resolve(this.htmlCachePath, '单文件版')
  }
  get htmlCacheCssPath() {
    return path.resolve(this.htmlCachePath, 'css')
  }
  get htmlCacheImgPath() {
    return path.resolve(this.htmlCachePath, 'image')
  }

  get htmlOutputPath() {
    return path.resolve(PathConfig.htmlOutputPath, this.bookname)
  }

  static get signature() {
    return `
        Generate:Base
        `
  }

  static get description() {
    return '生成电子书'
  }

  // 初始化静态资源(电子书 & html目录)
  initStaticRecource() {
    this.log(`删除旧目录`)
    this.log(`删除旧epub缓存资源目录:${this.epubCachePath}`)
    shelljs.rm('-rf', this.epubCachePath)
    this.log(`旧epub缓存目录删除完毕`)
    this.log(`删除旧epub输出资源目录:${this.epubOutputPath}`)
    shelljs.rm('-rf', this.epubOutputPath)
    this.log(`旧epub输出目录删除完毕`)
    this.log(`删除旧html资源目录:${this.htmlCachePath}`)
    shelljs.rm('-rf', this.htmlCachePath)
    this.log(`旧html资源目录删除完毕`)
    this.log(`删除旧html输出目录:${this.htmlOutputPath}`)
    shelljs.rm('-rf', this.htmlOutputPath)
    this.log(`旧html输出目录删除完毕`)

    this.log(`创建电子书:${this.bookname}对应文件夹`)
    shelljs.mkdir('-p', this.epubCachePath)
    shelljs.mkdir('-p', this.epubOutputPath)

    shelljs.mkdir('-p', this.htmlCachePath)
    shelljs.mkdir('-p', this.htmlCacheSingleHtmlPath)
    shelljs.mkdir('-p', this.htmlCacheHtmlPath)
    shelljs.mkdir('-p', this.htmlCacheCssPath)
    shelljs.mkdir('-p', this.htmlCacheImgPath)
    shelljs.mkdir('-p', this.htmlOutputPath)
    this.log(`电子书:${this.bookname}对应文件夹创建完毕`)

    this.epub = new Epub(this.bookname, this.epubCachePath)
  }
  processContent(content: string) {
    let that = this
    // 删除noscript标签内的元素
    function removeNoScript(rawHtml: string) {
      rawHtml = _.replace(rawHtml, /<\/br>/g, '')
      rawHtml = _.replace(rawHtml, /<br>/g, '<br/>')
      rawHtml = _.replace(rawHtml, /href="\/\/link.zhihu.com'/g, 'href="https://link.zhihu.com') // 修复跳转链接
      rawHtml = _.replace(rawHtml, /\<noscript\>.*?\<\/noscript\>/g, '')
      return rawHtml
    }

    // 替换图片地址(假定所有图片都在img文件夹下)
    function replaceImgSrc(rawHtml: string, isRaw = false) {
      rawHtml = _.replace(rawHtml, /img src="data:image.+?"/g, 'img')
      // 处理图片
      const imgContentList = rawHtml.match(/<img.+?>/g)
      let processedImgContentList = []
      if (imgContentList === null) {
        // html中没有图片
        return rawHtml
      }
      // 单条rawHtml直接replace替换性能开销太大, 所以应该先拆分, 然后再整体合成一个字符串
      let rawHtmlWithoutImgContentList = rawHtml.split(/<img.+?>/g)
      for (let imgContent of imgContentList) {
        let imgSrc = _.get(imgContent.match(`(?<=src=["']).+(?=["'])`), 0, '')
        let processedImgContent = imgContent
        if (that.imageQuilty === 'none' || imgSrc === '') {
          // 无图
          processedImgContent = ''
        } else {
          if (imgSrc.startsWith('//')) {
            imgSrc = 'https:' + imgSrc
          }
          processedImgContent = `<img src="${imgSrc}"/>`
          // 统一处理图片
          //<img style='width: 1rem;height: 1rem' src='//h5.sinaimg.cn/upload/2015/09/25/3/timeline_card_small_web_default.png'>
        }
        // 支持多看内读图
        processedImgContent = `<div class="duokan-image-single">${processedImgContent}</div>`

        if (that.imageQuilty === 'none') {
          // 没有图片, 也就不需要处理了, 直接跳过即可
          processedImgContentList.push(processedImgContent)
          continue
        }

        // 将图片地址提取到图片池中
        // 将html内图片地址替换为html内的地址
        let matchImgSrc = processedImgContent.match(/(?<= src=")[^"]+/)
        let rawImgSrc = _.get(matchImgSrc, [0], '')
        if (rawImgSrc.length > 0) {
          that.imgUriPool.add(rawImgSrc)
        }
        let filename = that.getImgName(rawImgSrc)
        let htmlImgUri = '../image/' + filename
        processedImgContent = _.replace(processedImgContent, rawImgSrc, htmlImgUri)

        processedImgContentList.push(processedImgContent)
      }
      // 拼接 rawHtmlWithoutImgContentList 和 processImgContentList 成 rawHtml
      let strMergeList = []
      for (let index = 0; index < rawHtmlWithoutImgContentList.length; index++) {
        strMergeList.push(rawHtmlWithoutImgContentList[index])
        strMergeList.push(_.get(processedImgContentList, [index], ''))
      }
      let processedHtml = strMergeList.join('')
      return processedHtml
    }
    content = removeNoScript(content)
    let tinyContentList = content.split(`<div data-key='single-page'`).map(value => {
      return replaceImgSrc(value)
    })
    content = tinyContentList.join(`<div data-key='single-page'`)
    return content
  }

  /**
   * 下载图片
   */
  async downloadImg() {
    let index = 0
    for (let src of this.imgUriPool) {
      index++
      let filename = this.getImgName(src)
      let cacheUri = path.resolve(PathConfig.imgCachePath, filename)
      // 检查缓存中是否有该文件
      if (fs.existsSync(cacheUri)) {
        this.log(`[第${index}张图片]-0-将第${index}/${this.imgUriPool.size}张图片已存在,自动跳过`)
        continue
      }

      // 分批下载
      this.log(`[第${index}张图片]-0-将第${index}/${this.imgUriPool.size}张图片添加到任务队列中`)
      await CommonUtil.asyncAppendPromiseWithDebounce(this.asyncDownloadImg(index, src, cacheUri))
    }
    this.log(`清空任务队列`)
    await CommonUtil.asyncAppendPromiseWithDebounce(this.emptyPromiseFunction(), true)
    this.log(`所有图片下载完毕`)
  }

  private async asyncDownloadImg(index: number, src: string, cacheUri: string) {
    await CommonUtil.asyncSleep(1)
    // 确保下载日志可以和下载成功的日志一起输出, 保证日志完整性, 方便debug
    this.log(`[第${index}张图片]-1-准备下载第${index}/${this.imgUriPool.size}张图片, src => ${src}`)
    let imgContent = await http.downloadImg(src).catch(e => {
      this.log(`[第${index}张图片]-1-2-第${index}/${this.imgUriPool.size}张图片下载失败, 自动跳过`)
      this.log(`[第${index}张图片]-1-3-错误原因 =>`, e.message)
      return ''
    })
    if (imgContent === '') {
      this.log(`[第${index}张图片]-1-4-下载失败, 图片内容为空`)
      return
    }
    this.log(`[第${index}张图片]-2-第${index}/${this.imgUriPool.size}张图片下载完成, src => ${src}`)
    // 调用writeFileSync时间长了之后可能会卡在这上边, 导致程序无响应, 因此改用promise试一下
    this.log(`[第${index}张图片]-3-准备写入文件:${cacheUri}`)
    await CommonUtil.asyncSleep(10)
    fs.writeFileSync(cacheUri, imgContent)
    this.log(`[第${index}张图片]-4-第${index}/${this.imgUriPool.size}张图片储存完毕`)
  }

  copyImgToCache(imgCachePath: string) {
    let index = 0
    for (let src of this.imgUriPool) {
      index++
      let filename = this.getImgName(src)
      // 避免文件名不存在的情况
      if (filename === '') {
        continue
      }
      let imgCacheUri = path.resolve(PathConfig.imgCachePath, filename)
      let imgToUri = path.resolve(imgCachePath, filename)
      if (fs.existsSync(imgCacheUri)) {
        fs.copyFileSync(imgCacheUri, imgToUri)
        this.log(`第${index}/${this.imgUriPool.size}张图片复制完毕`)
      } else {
        this.log(`第${index}/${this.imgUriPool.size}张图片不存在, 自动跳过`)
        this.log(`src => ${src}`)
      }
      this.epub.addImage(imgToUri)
    }
    this.log(`全部图片复制完毕`)
  }

  copyStaticResource() {
    // css
    for (let filename of ['bootstrap.css', 'customer.css', 'markdown.css', 'normalize.css']) {
      let copyFromUri = path.resolve(PathConfig.resourcePath, 'css', filename)
      let copyToUri = path.resolve(this.htmlCacheCssPath, filename)
      fs.copyFileSync(copyFromUri, copyToUri)
      this.epub.addCss(copyToUri)
    }
    // 图片资源
    for (let filename of ['cover.jpg', 'kanshan.png']) {
      let copyFromUri = path.resolve(PathConfig.resourcePath, 'image', filename)
      let copyToUri = path.resolve(this.htmlCacheImgPath, filename)
      fs.copyFileSync(copyFromUri, copyToUri)
      this.epub.addImage(copyToUri)
    }

    // 设置封面
    let coverCopyFromUri = path.resolve(PathConfig.resourcePath, 'image', 'cover.jpg')
    let coverCopyToUri = path.resolve(this.htmlCacheImgPath, 'cover.jpg')
    fs.copyFileSync(coverCopyFromUri, coverCopyToUri)
    this.epub.addCoverImage(coverCopyToUri)
  }

  async asyncProcessStaticResource() {
    this.log(`内容列表预处理完毕, 准备下载图片`)
    // 下载图片
    this.log(`开始下载图片, 共${this.imgUriPool.size}张待下载`)
    await this.downloadImg()
    this.log(`图片下载完毕`)
    this.log(`将图片从图片池复制到电子书文件夹中`)
    this.copyImgToCache(this.htmlCacheImgPath)
    this.log(`图片复制完毕`)

    this.log(`复制静态资源`)
    this.copyStaticResource()
    this.log(`静态资源完毕`)

    this.log(`生成电子书`)
    await this.epub.asyncGenerate()
    this.log(`电子书生成完毕`)

    this.log(`将生成文件复制到目标文件夹`)
    this.log(`复制epub电子书`)
    fs.copyFileSync(
      path.resolve(this.epubCachePath, this.bookname + '.epub'),
      path.resolve(this.epubOutputPath, this.bookname + '.epub'),
    )
    this.log(`epub电子书复制完毕`)
    this.log(`复制网页`)
    shelljs.cp('-r', path.resolve(this.htmlCachePath), path.resolve(this.htmlOutputPath))
    this.log(`网页复制完毕`)
  }

  /**
   * 根据图片地址生成图片名
   * @param src
   */
  getImgName(src: string) {
    // 直接将路径信息md5
    let filename = ''
    try {
      let srcMd5 = md5(src)
      let urlObj = new url.URL(src)
      let pathname = urlObj.pathname
      if (path.extname(pathname) === '') {
        // 避免没有后缀名
        pathname = `${pathname}.jpg`
      }
      if (pathname.length > 50) {
        // 文件名不能过长, 否则用户无法直接删除该文件
        pathname = pathname.substr(pathname.length - 50, 50)
      }
      filename = StringUtil.encodeFilename(`${srcMd5}_${pathname}`)
    } catch (e) {
      // 非url, 不需要进行处理, 返回空即可
      logger.warn(`[警告]传入值src:${src}不是合法url, 将返回空filename`)
    }
    return filename
  }
}

export default FetchBase