; inherits: c_sharp

([
  (html_comment)
  (razor_comment)
] @injection.content
  (#set! injection.language "comment"))

((element) @injection.content
  (#not-has-ancestor? @injection.content element)
  (#set! injection.language "html")
  (#set! injection.include-children)
  (#set! injection.combined))
