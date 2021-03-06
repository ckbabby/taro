import generate from 'babel-generator'
import { NodePath } from 'babel-traverse'
import * as t from 'babel-types'
import { kebabCase } from 'lodash'
import { DEFAULT_Component_SET, SPECIAL_COMPONENT_PROPS } from './constant'
import { createHTMLElement } from './create-html-element'
import { codeFrameError } from './utils'
import { Adapter, Adapters } from './adapter'

export function isStartWithWX (str: string) {
  return str[0] === 'w' && str[1] === 'x'
}

const specialComponentName = ['block', 'Block', 'slot', 'Slot']

export function removeJSXThisProperty (path: NodePath<t.ThisExpression>) {
  if (!path.parentPath.isCallExpression()) {
    const p = path.getSibling('property')
    if (
      p.isIdentifier({ name: 'props' }) ||
      p.isIdentifier({ name: 'state' })
    ) {
      path.parentPath.replaceWithSourceString('this')
    } else {
      path.parentPath.replaceWith(p)
    }
  }
}

export function findJSXAttrByName (attrs: t.JSXAttribute[], name: string) {
  for (const attr of attrs) {
    if (!t.isJSXIdentifier(attr.name)) {
      break
    }
    if (attr.name.name === name) {
      return attr
    }
  }
  return null
}

export function buildRefTemplate (name: string, refName?: string, loop?: boolean, key?: t.JSXAttribute) {
  const attrs = [
    t.jSXAttribute(t.jSXIdentifier('is'), t.stringLiteral(name)),
    t.jSXAttribute(t.jSXIdentifier('data'), t.stringLiteral(`{{...${refName ? `${loop ? '' : '$$'}${refName}` : '__data'}}}`))
  ]
  if (key) {
    attrs.push(key)
  }
  return t.jSXElement(
    t.jSXOpeningElement(t.jSXIdentifier('template'), attrs),
    t.jSXClosingElement(t.jSXIdentifier('template')),
    []
  )
}

export function buildJSXAttr (name: string, value: t.Identifier | t.Expression) {
  return t.jSXAttribute(t.jSXIdentifier(name), t.jSXExpressionContainer(value))
}

export function newJSXIfAttr (
  jsx: t.JSXElement,
  value: t.Identifier | t.Expression
) {
  jsx.openingElement.attributes.push(buildJSXAttr(Adapter.if, value))
}

export function setJSXAttr (
  jsx: t.JSXElement,
  name: string,
  value?: t.StringLiteral | t.JSXExpressionContainer | t.JSXElement,
  path?: NodePath<t.JSXElement>
) {
  const element = jsx.openingElement
  if (!t.isJSXIdentifier(element.name)) {
    return
  }
  if (element.name.name === 'Block' || element.name.name === 'block' || !path) {
    jsx.openingElement.attributes.push(
      t.jSXAttribute(t.jSXIdentifier(name), value)
    )
  } else {
    const block = buildBlockElement()
    setJSXAttr(block, name, value)
    block.children = [jsx]
    path.node = block
  }
}

export function isAllLiteral (...args) {
  return args.every(p => t.isLiteral(p))
}

export function buildBlockElement () {
  return t.jSXElement(
    t.jSXOpeningElement(t.jSXIdentifier('block'), []),
    t.jSXClosingElement(t.jSXIdentifier('block')),
    []
  )
}

function parseJSXChildren (
  children: (t.JSXElement | t.JSXText | t.JSXExpressionContainer)[]
): string {
  return children
    .filter(child => {
      return !(t.isJSXText(child) && child.value.trim() === '')
    })
    .reduce((str, child) => {
      if (t.isJSXText(child)) {
        return str + child.value
      }
      if (t.isJSXElement(child)) {
        return str + parseJSXElement(child)
      }
      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXElement(child.expression)) {
          return str + parseJSXElement(child.expression)
        }
        return str + `{${
          generate(child, {
            quotes: 'single'
          })
          .code
          .replace(/(this\.props\.)|(this\.state\.)/g, '')
          .replace(/(props\.)|(state\.)/g, '')
          .replace(/this\./, '')
        }}`
      }
      return str
    }, '')
}

export function parseJSXElement (element: t.JSXElement): string {
  const children = element.children
  const { attributes, name } = element.openingElement
  const TRIGGER_OBSERER = Adapter.type === Adapters.swan ? 'privateTriggerObserer' : '__triggerObserer'
  if (t.isJSXMemberExpression(name)) {
    throw codeFrameError(name.loc, '暂不支持 JSX 成员表达式')
  }
  const componentName = name.name
  const isDefaultComponent = DEFAULT_Component_SET.has(componentName)
  const componentSpecialProps = SPECIAL_COMPONENT_PROPS.get(componentName)
  let attributesTrans = {}
  if (attributes.length) {
    attributesTrans = attributes.reduce((obj, attr) => {
      if (t.isJSXSpreadAttribute(attr)) {
        throw codeFrameError(attr.loc, 'JSX 参数暂不支持 ...spread 表达式')
      }
      let name = attr.name.name
      if (DEFAULT_Component_SET.has(componentName)) {
        if (name === 'className') {
          name = 'class'
        }
      }
      let value: string | boolean = true
      let attrValue = attr.value
      if (typeof name === 'string') {
        const isAlipayEvent = Adapter.type === Adapters.alipay && /(on[A-Z_])|(catch[A-Z_])/.test(name)
        if (t.isStringLiteral(attrValue)) {
          value = attrValue.value
        } else if (t.isJSXExpressionContainer(attrValue)) {
          let isBindEvent =
            (name.startsWith('bind') && name !== 'bind') || (name.startsWith('catch') && name !== 'catch')
          let { code } = generate(attrValue.expression, {
            quotes: 'single',
            concise: true
          })
          code = code
            .replace(/"/g, "'")
            .replace(/(this\.props\.)|(this\.state\.)/g, '')
            .replace(/this\./g, '')
          value = isBindEvent || isAlipayEvent ? code : `{{${code}}}`
          if (Adapter.type === Adapters.swan && name === Adapter.for) {
            value = code
          }
          if (t.isStringLiteral(attrValue.expression)) {
            value = attrValue.expression.value
          }
        } else if (attrValue === null && name !== Adapter.else) {
          value = `{{true}}`
        }
        if ((componentName === 'Input' || componentName === 'input') && name === 'maxLength') {
          obj['maxlength'] = value
        } else if (
          componentSpecialProps && componentSpecialProps.has(name) ||
          name.startsWith('__fn_') ||
          isAlipayEvent
        ) {
          obj[name] = value
        } else {
          obj[isDefaultComponent && !name.includes('-') && !name.includes(':') ? kebabCase(name) : name] = value
        }
      }
      if (!isDefaultComponent && !specialComponentName.includes(componentName)) {
        obj[TRIGGER_OBSERER] = '{{ _triggerObserer }}'
      }
      return obj
    }, {})
  } else if (!isDefaultComponent && !specialComponentName.includes(componentName)) {
    attributesTrans[TRIGGER_OBSERER] = '{{ _triggerObserer }}'
  }
  return createHTMLElement({
    name: kebabCase(componentName),
    attributes: attributesTrans,
    value: parseJSXChildren(children)
  })
}

export function generateHTMLTemplate (template: t.JSXElement, name: string) {
  return createHTMLElement({
    name: 'template',
    attributes: {
      name
    },
    value: parseJSXElement(template)
  })
}
