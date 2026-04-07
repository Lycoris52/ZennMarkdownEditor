<?php

if (!defined('ABSPATH')) {
	exit;
}

final class MPE_Markdown_Parser {
	public static function render(string $markdown): string {
		$markdown = str_replace(array("\r\n", "\r"), "\n", $markdown);
		$markdown = preg_replace('/<!--.*?-->/s', '', $markdown);
		$lines = explode("\n", $markdown);
		$footnotes = array();
		$lines = self::extract_footnote_definitions($lines, $footnotes);
		$footnote_state = array(
			'next_number' => 1,
			'items' => array(),
			'inline_next' => 1,
		);
		$heading_ids = array();
		$html = '';
		$paragraph = array();
		$list_type = null;
		$list_items = array();
		$blockquote = array();
		$table_lines = array();
		$in_code_block = false;
		$in_math_block = false;
		$code_lang = 'text';
		$code_diff_lang = '';
		$code_filename = '';
		$code_lines = array();
		$math_lines = array();
		$indented_code_lines = array();

		$line_count = count($lines);
		for ($line_index = 0; $line_index < $line_count; $line_index++) {
			$line = $lines[$line_index];
			if ($in_code_block) {
				if (preg_match('/^```(.*)$/', $line) === 1) {
					$html .= self::render_code_block(implode("\n", $code_lines), $code_lang, $code_filename, $code_diff_lang);
					$code_lines = array();
					$code_lang = 'text';
					$code_diff_lang = '';
					$code_filename = '';
					$in_code_block = false;
				} else {
					$code_lines[] = $line;
				}

				continue;
			}

			if (!empty($indented_code_lines)) {
				if (preg_match('/^(?:\t| {4})(.*)$/', $line, $indented_matches) === 1) {
					$indented_code_lines[] = $indented_matches[1];
					continue;
				}

				if (trim($line) === '') {
					$indented_code_lines[] = '';
					continue;
				}

				$html .= self::render_code_block(implode("\n", $indented_code_lines), 'text', '', '');
				$indented_code_lines = array();
			}

			if (preg_match('/^(:{3,})(message|details)(?:\s+(.*))?$/', $line, $custom_matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);

				$custom_block = self::consume_zenn_block($lines, $line_index, strlen($custom_matches[1]), $custom_matches[2], isset($custom_matches[3]) ? $custom_matches[3] : '');
				$line_index = $custom_block['end_index'];
				$html .= self::render_zenn_block($custom_block['type'], $custom_block['argument'], $custom_block['content']);
				continue;
			}

			if (preg_match('/^@\[([a-z]+)\]\((https?:\/\/[^\s)]+|[A-Za-z0-9_-]+)\)$/', trim($line), $embed_matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$html .= self::render_embed_directive($embed_matches[1], $embed_matches[2]);
				continue;
			}

			if (preg_match('/^https?:\/\/\S+$/', trim($line)) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$html .= self::render_embed_url(trim($line));
				continue;
			}

			if ($in_math_block) {
				if (trim($line) === '$$') {
					$html .= self::render_math_block(implode("\n", $math_lines));
					$math_lines = array();
					$in_math_block = false;
				} else {
					$math_lines[] = $line;
				}

				continue;
			}

			if (preg_match('/^```(.*)$/', $line, $matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);

				$info = self::parse_fence_info($matches[1]);
				$code_lang = $info['lang'];
				$code_diff_lang = $info['diff_lang'];
				$code_filename = $info['filename'];
				$in_code_block = true;
				continue;
			}

			if (preg_match('/^(?:\t| {4})(.*)$/', $line, $indented_matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$indented_code_lines[] = $indented_matches[1];
				continue;
			}

			if (trim($line) === '$$') {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);

				$in_math_block = true;
				continue;
			}

			if (trim($line) === '') {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				continue;
			}

			if (preg_match('/^(#{1,6})\s+(.*)$/', $line, $matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$level = strlen($matches[1]);
				$heading_id = self::generate_heading_id($matches[2], $heading_ids);
				$html .= sprintf('<h%d id="%s">%s</h%d>', $level, esc_attr($heading_id), self::render_inline($matches[2], false, $footnotes, $footnote_state), $level);
				continue;
			}

			if (preg_match('/^>\s?(.*)$/', $line, $matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$blockquote[] = $matches[1];
				continue;
			}

			if (self::is_table_line($line)) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				$table_lines[] = $line;
				continue;
			}

			self::flush_table($html, $table_lines, $footnotes, $footnote_state);

			if (preg_match('/^([-*+])\s+(.*)$/', $line, $matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				if ($list_type !== 'ul') {
					self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
					$list_type = 'ul';
				}
				$list_items[] = $matches[2];
				continue;
			}

			if (preg_match('/^\d+\.\s+(.*)$/', $line, $matches) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				if ($list_type !== 'ol') {
					self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
					$list_type = 'ol';
				}
				$list_items[] = $matches[1];
				continue;
			}

			if (preg_match('/^---+$/', trim($line)) === 1) {
				self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
				self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
				self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
				self::flush_table($html, $table_lines, $footnotes, $footnote_state);
				$html .= '<hr />';
				continue;
			}

			$paragraph[] = $line;
		}

		if ($in_code_block) {
			$html .= self::render_code_block(implode("\n", $code_lines), $code_lang, $code_filename, $code_diff_lang);
		}

		if (!empty($indented_code_lines)) {
			$html .= self::render_code_block(implode("\n", $indented_code_lines), 'text', '', '');
		}

		if ($in_math_block) {
			$html .= self::render_math_block(implode("\n", $math_lines));
		}

		self::flush_paragraph($html, $paragraph, $footnotes, $footnote_state);
		self::flush_list($html, $list_type, $list_items, $footnotes, $footnote_state);
		self::flush_blockquote($html, $blockquote, $footnotes, $footnote_state);
		self::flush_table($html, $table_lines, $footnotes, $footnote_state);
		$html .= self::render_footnotes($footnotes, $footnote_state);

		return '<div class="mpe-rendered-content">' . $html . '</div>';
	}

	private static function consume_zenn_block(array $lines, int $start_index, int $colon_count, string $type, string $argument): array {
		$content_lines = array();
		$end_index = $start_index;
		$line_count = count($lines);
		$closing_pattern = '/^' . preg_quote(str_repeat(':', $colon_count), '/') . '\s*$/';

		for ($i = $start_index + 1; $i < $line_count; $i++) {
			if (preg_match($closing_pattern, $lines[$i]) === 1) {
				$end_index = $i;
				break;
			}

			$content_lines[] = $lines[$i];
			$end_index = $i;
		}

		return array(
			'type' => $type,
			'argument' => trim($argument),
			'content' => implode("\n", $content_lines),
			'end_index' => $end_index,
		);
	}

	private static function render_zenn_block(string $type, string $argument, string $content): string {
		$inner_html = self::render($content);
		$inner_html = preg_replace('/^<div class="mpe-rendered-content">/', '', $inner_html);
		$inner_html = preg_replace('/<\/div>$/', '', $inner_html);

		if ($type === 'message') {
			$modifier = trim($argument) === 'alert' ? ' mpe-zenn-message-alert' : '';
			return '<div class="mpe-zenn-message' . esc_attr($modifier) . '">' . $inner_html . '</div>';
		}

		if ($type === 'details') {
			return '<details class="mpe-zenn-details"><summary>' . esc_html($argument) . '</summary>' . $inner_html . '</details>';
		}

		return $inner_html;
	}

	private static function render_embed_directive(string $type, string $value): string {
		$type = strtolower(trim($type));
		$value = trim($value);

		if ($type === 'youtube') {
			return self::render_youtube_embed($value);
		}

		if ($type === 'tweet') {
			return self::render_tweet_embed($value);
		}

		if ($type === 'gist') {
			return self::render_gist_embed($value);
		}

		if ($type === 'card') {
			return self::render_card_embed($value, 'mpe-embed-card');
		}

		return self::render_card_embed($value, 'mpe-embed-card');
	}

	private static function render_embed_url(string $url): string {
		$host = wp_parse_url($url, PHP_URL_HOST);
		$host = is_string($host) ? strtolower($host) : '';

		if (strpos($host, 'youtube.com') !== false || strpos($host, 'youtu.be') !== false) {
			return self::render_youtube_embed($url);
		}

		if (strpos($host, 'twitter.com') !== false || strpos($host, 'x.com') !== false) {
			return self::render_tweet_embed($url);
		}

		if (strpos($host, 'gist.github.com') !== false) {
			return self::render_gist_embed($url);
		}

		if (strpos($host, 'github.com') !== false && self::is_github_blob_url($url)) {
			return self::render_github_embed($url);
		}

		return self::render_card_embed($url, 'mpe-embed-card');
	}

	private static function is_github_blob_url(string $url): bool {
		$path = wp_parse_url($url, PHP_URL_PATH);
		if (!is_string($path) || $path === '') {
			return false;
		}

		$parts = array_values(array_filter(explode('/', trim($path, '/'))));
		return count($parts) >= 5 && $parts[2] === 'blob';
	}

	private static function render_card_embed(string $url, string $modifier_class): string {
		$host = wp_parse_url($url, PHP_URL_HOST);
		$label = is_string($host) && $host !== '' ? $host : $url;
		$brand = self::render_embed_brand($label);
		return '<a class="mpe-embed-link ' . esc_attr($modifier_class) . '" href="' . esc_url($url) . '" target="_blank" rel="noopener noreferrer"><span class="mpe-embed-main"><span class="mpe-embed-label">' . esc_html($label) . '</span><span class="mpe-embed-url">' . esc_html($url) . '</span><span class="mpe-embed-site"><span class="mpe-embed-site-icon" aria-hidden="true">' . self::render_embed_site_icon($label) . '</span><span class="mpe-embed-site-name">' . esc_html($label) . '</span></span></span>' . $brand . '</a>';
	}

	private static function render_embed_site_icon(string $host): string {
		$host = strtolower(trim($host));
		$favicon_url = 'https://www.google.com/s2/favicons?domain=' . rawurlencode($host) . '&sz=64';
		return '<img src="' . esc_url($favicon_url) . '" alt="" loading="lazy" decoding="async" />';
	}

	private static function render_embed_brand(string $host): string {
		$host = strtolower(trim($host));
		$favicon_url = 'https://www.google.com/s2/favicons?domain=' . rawurlencode($host) . '&sz=256';
		return '<span class="mpe-embed-brand" aria-hidden="true"><img src="' . esc_url($favicon_url) . '" alt="" loading="lazy" decoding="async" /><span class="mpe-embed-brand-fallback">' . esc_html($host) . '</span></span>';
	}

	private static function render_github_embed(string $url): string {
		return '<div class="mpe-embed-github" data-github-url="' . esc_url($url) . '"><a class="mpe-embed-link mpe-embed-github-fallback" href="' . esc_url($url) . '" target="_blank" rel="noopener noreferrer"><span class="mpe-embed-label">' . esc_html($url) . '</span></a></div>';
	}

	private static function render_gist_embed(string $url): string {
		$gist_id = self::extract_gist_id($url);
		if ($gist_id === '') {
			return self::render_card_embed($url, 'mpe-embed-card');
		}

		return '<div class="mpe-embed-gist" data-gist-id="' . esc_attr($gist_id) . '" data-gist-url="' . esc_url($url) . '"><a class="mpe-embed-link mpe-embed-gist-fallback" href="' . esc_url($url) . '" target="_blank" rel="noopener noreferrer"><span class="mpe-embed-label">' . esc_html($url) . '</span></a></div>';
	}

	private static function render_tweet_embed(string $url): string {
		$tweet_id = self::extract_tweet_id($url);
		if ($tweet_id === '') {
			return self::render_card_embed($url, 'mpe-embed-card');
		}

		return '<div class="mpe-embed-tweet" data-tweet-id="' . esc_attr($tweet_id) . '" data-tweet-url="' . esc_url($url) . '"><a class="mpe-embed-link mpe-embed-tweet-fallback" href="' . esc_url($url) . '" target="_blank" rel="noopener noreferrer">' . esc_html($url) . '</a></div>';
	}

	private static function render_youtube_embed(string $value): string {
		$video_id = self::extract_youtube_video_id($value);
		if ($video_id === '') {
			return self::render_card_embed($value, 'mpe-embed-card');
		}

		$embed_url = 'https://www.youtube.com/embed/' . rawurlencode($video_id);
		return '<div class="mpe-embed-youtube"><iframe src="' . esc_url($embed_url) . '" title="' . esc_attr__('YouTube video', 'mpe') . '" loading="lazy" allowfullscreen></iframe></div>';
	}

	private static function extract_youtube_video_id(string $value): string {
		$value = trim($value);
		if (preg_match('/^[A-Za-z0-9_-]{6,}$/', $value) === 1 && strpos($value, 'http') !== 0) {
			return $value;
		}

		$host = wp_parse_url($value, PHP_URL_HOST);
		$path = wp_parse_url($value, PHP_URL_PATH);
		$query = wp_parse_url($value, PHP_URL_QUERY);
		parse_str(is_string($query) ? $query : '', $query_args);

		if (is_string($host) && strpos(strtolower($host), 'youtu.be') !== false && is_string($path)) {
			return trim($path, '/');
		}

		if (isset($query_args['v']) && is_string($query_args['v'])) {
			return $query_args['v'];
		}

		if (is_string($path) && preg_match('#/embed/([^/]+)#', $path, $matches) === 1) {
			return $matches[1];
		}

		return '';
	}

	private static function extract_tweet_id(string $url): string {
		$path = wp_parse_url($url, PHP_URL_PATH);
		if (!is_string($path)) {
			return '';
		}

		if (preg_match('#/status/(\d+)#', $path, $matches) === 1) {
			return $matches[1];
		}

		return '';
	}

	private static function extract_gist_id(string $url): string {
		$path = wp_parse_url($url, PHP_URL_PATH);
		if (!is_string($path)) {
			return '';
		}

		if (preg_match('#/([a-f0-9]{8,})/?$#i', $path, $matches) === 1) {
			return $matches[1];
		}

		return '';
	}

	private static function flush_paragraph(string &$html, array &$paragraph, array &$footnotes, array &$footnote_state): void {
		if (empty($paragraph)) {
			return;
		}

		$html .= '<p>' . self::render_inline(implode("\n", $paragraph), true, $footnotes, $footnote_state) . '</p>';
		$paragraph = array();
	}

	private static function flush_list(string &$html, ?string &$list_type, array &$list_items, array &$footnotes, array &$footnote_state): void {
		if ($list_type === null || empty($list_items)) {
			$list_type = null;
			$list_items = array();
			return;
		}

		$html .= '<' . $list_type . '>';
		foreach ($list_items as $item) {
			$html .= '<li>' . self::render_inline($item, false, $footnotes, $footnote_state) . '</li>';
		}
		$html .= '</' . $list_type . '>';

		$list_type = null;
		$list_items = array();
	}

	private static function flush_blockquote(string &$html, array &$blockquote, array &$footnotes, array &$footnote_state): void {
		if (empty($blockquote)) {
			return;
		}

		$rendered = array();
		foreach ($blockquote as $line) {
			$rendered[] = self::render_inline($line, false, $footnotes, $footnote_state);
		}

		$html .= '<blockquote><p>' . implode('<br />', $rendered) . '</p></blockquote>';
		$blockquote = array();
	}

	private static function flush_table(string &$html, array &$table_lines, array &$footnotes, array &$footnote_state): void {
		if (count($table_lines) < 2 || !self::is_table_separator($table_lines[1])) {
			if (!empty($table_lines)) {
				$html .= '<p>' . self::render_inline(implode("\n", $table_lines), true, $footnotes, $footnote_state) . '</p>';
			}
			$table_lines = array();
			return;
		}

		$headers = self::split_table_row($table_lines[0]);
		$rows = array_slice($table_lines, 2);

		$html .= '<table><thead><tr>';
		foreach ($headers as $header) {
			$html .= '<th>' . self::render_inline($header, false, $footnotes, $footnote_state) . '</th>';
		}
		$html .= '</tr></thead><tbody>';

		foreach ($rows as $row) {
			$cells = self::split_table_row($row);
			if (empty($cells)) {
				continue;
			}
			$html .= '<tr>';
			foreach ($cells as $cell) {
				$html .= '<td>' . self::render_inline($cell, false, $footnotes, $footnote_state) . '</td>';
			}
			$html .= '</tr>';
		}

		$html .= '</tbody></table>';
		$table_lines = array();
	}

	private static function is_table_line(string $line): bool {
		return strpos($line, '|') !== false;
	}

	private static function is_table_separator(string $line): bool {
		$cells = self::split_table_row($line);
		if (empty($cells)) {
			return false;
		}

		foreach ($cells as $cell) {
			if (preg_match('/^:?-+:?$/', trim($cell)) !== 1) {
				return false;
			}
		}

		return true;
	}

	private static function split_table_row(string $line): array {
		$line = trim($line);
		$line = trim($line, '|');
		$cells = array_map('trim', explode('|', $line));
		return array_values(array_filter($cells, static function (string $cell): bool {
			return $cell !== '';
		}));
	}

	private static function parse_fence_info(string $info): array {
		$info = trim($info);
		if ($info === '') {
			return array(
				'lang' => 'text',
				'diff_lang' => '',
				'filename' => '',
			);
		}

		$segments = preg_split('/\s+/', $info);
		$segments = is_array($segments) ? array_values(array_filter($segments, static function ($segment): bool {
			return $segment !== '';
		})) : array();

		$lang = 'text';
		$diff_lang = '';
		$filename = '';

		if (isset($segments[0]) && $segments[0] === 'diff') {
			$lang = 'diff';
			if (isset($segments[1])) {
				$lang_and_filename = explode(':', $segments[1], 2);
				$diff_lang = trim($lang_and_filename[0]);
				$filename = isset($lang_and_filename[1]) ? trim($lang_and_filename[1]) : '';
			}
		} else {
			$parts = explode(':', $info, 2);
			$lang = trim($parts[0]);
			$filename = isset($parts[1]) ? trim($parts[1]) : '';
		}

		return array(
			'lang' => $lang !== '' ? strtolower($lang) : 'text',
			'diff_lang' => strtolower($diff_lang),
			'filename' => $filename,
		);
	}

	private static function plain_text_from_inline(string $text): string {
		$text = preg_replace('/!\[([^\]]*)\]\((.*?)\)/', '$1', $text);
		$text = preg_replace('/\[([^\]]+)\]\((.*?)\)/', '$1', $text);
		$text = preg_replace('/`([^`]+)`/', '$1', $text);
		$text = preg_replace('/\^\[([^\]]+)\]|\[\^([^\]]+)\]/', '', $text);
		$text = preg_replace('/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/s', '$1', $text);
		$text = preg_replace('/[*_~#]+/', '', $text);
		$text = html_entity_decode(wp_strip_all_tags($text), ENT_QUOTES, 'UTF-8');
		return trim((string) preg_replace('/\s+/u', ' ', $text));
	}

	private static function normalize_anchor_target(string $text): string {
		$normalized = self::plain_text_from_inline($text);
		$normalized = trim((string) preg_replace('/\s+/u', ' ', $normalized));

		if ($normalized === '') {
			return 'mpe-section';
		}

		if (preg_match('/^[A-Za-z0-9 _-]+$/', $normalized) === 1) {
			$ascii_slug = strtolower($normalized);
			$ascii_slug = preg_replace('/\s+/', '-', $ascii_slug);
			$ascii_slug = preg_replace('/[^a-z0-9_-]/', '', $ascii_slug);
			$ascii_slug = trim((string) $ascii_slug, '-');
			return $ascii_slug !== '' ? $ascii_slug : 'mpe-section';
		}

		return 'mpe-' . str_replace('%', '-', strtolower(rawurlencode($normalized)));
	}

	private static function generate_heading_id(string $text, array &$heading_ids): string {
		$base = self::normalize_anchor_target($text);

		if (!isset($heading_ids[$base])) {
			$heading_ids[$base] = 0;
			return $base;
		}

		$heading_ids[$base]++;
		return $base . '-' . $heading_ids[$base];
	}

	private static function render_code_block(string $code, string $lang, string $filename, string $diff_lang = ''): string {
		$lang = $lang !== '' ? $lang : 'text';
		$diff_lang = trim($diff_lang);
		$base_lang = $lang === 'diff' && $diff_lang !== '' ? $diff_lang : $lang;
		$is_diff = $lang === 'diff';
		$shell_class = $filename !== '' ? 'mpe-code-shell mpe-code-shell-has-header' : 'mpe-code-shell';
		$html = '<div class="' . esc_attr($shell_class) . '" data-code-lang="' . esc_attr($base_lang) . '"';

		if ($is_diff) {
			$html .= ' data-code-mode="diff"';
		}

		if ($diff_lang !== '') {
			$html .= ' data-code-diff-lang="' . esc_attr($diff_lang) . '"';
		}

		$html .= '>';

		if ($filename !== '') {
			$html .= '<div class="mpe-code-header">' . esc_html($filename) . '</div>';
		}

		$html .= '<div class="mpe-code-block"><div class="mpe-code-body">';
		$html .= '<button type="button" class="mpe-code-copy" aria-label="' . esc_attr__('Copy code', 'mpe') . '">Copy</button>';
		$html .= '<pre class="mpe-code-pre"><code class="language-' . esc_attr($base_lang) . '">' . esc_html($code) . '</code></pre>';
		$html .= '</div></div></div>';

		return $html;
	}

	private static function render_math_block(string $math): string {
		$math = trim($math);
		return '<div class="mpe-math-block" data-math="' . esc_attr($math) . '">' . esc_html($math) . '</div>';
	}

	private static function extract_footnote_definitions(array $lines, array &$footnotes): array {
		$filtered = array();
		$count = count($lines);

		for ($i = 0; $i < $count; $i++) {
			$line = $lines[$i];
			if (preg_match('/^\[\^([^\]]+)\]:\s*(.*)$/', $line, $matches) !== 1) {
				$filtered[] = $line;
				continue;
			}

			$id = trim($matches[1]);
			$content_lines = array($matches[2]);

			while ($i + 1 < $count && preg_match('/^(?:\s{2,}|\t)(.*)$/', $lines[$i + 1], $continuation) === 1) {
				$i++;
				$content_lines[] = $continuation[1];
			}

			$footnotes[$id] = implode("\n", $content_lines);
		}

		return $filtered;
	}

	private static function get_footnote_reference_id(string $footnote_id, int $reference_index): string {
		return 'mpe-fnref-' . sanitize_html_class($footnote_id) . '-' . $reference_index;
	}

	private static function get_footnote_item_id(string $footnote_id): string {
		return 'mpe-fn-' . sanitize_html_class($footnote_id);
	}

	private static function render_footnote_reference(string $footnote_id, array &$footnote_state): string {
		if (!isset($footnote_state['items'][$footnote_id])) {
			$footnote_state['items'][$footnote_id] = array(
				'number' => $footnote_state['next_number'],
				'references' => 0,
			);
			$footnote_state['next_number']++;
		}

		$footnote_state['items'][$footnote_id]['references']++;
		$reference_index = $footnote_state['items'][$footnote_id]['references'];
		$number = $footnote_state['items'][$footnote_id]['number'];
		$reference_id = self::get_footnote_reference_id($footnote_id, $reference_index);
		$item_id = self::get_footnote_item_id($footnote_id);

		return '<sup class="mpe-footnote-ref" id="' . esc_attr($reference_id) . '"><a href="#' . esc_attr($item_id) . '">' . esc_html((string) $number) . '</a></sup>';
	}

	private static function render_footnotes(array $footnotes, array $footnote_state): string {
		if (empty($footnote_state['items'])) {
			return '';
		}

		$items = $footnote_state['items'];
		uasort($items, static function (array $left, array $right): int {
			return $left['number'] <=> $right['number'];
		});

		$html = '<section class="mpe-footnotes"><hr /><ol>';

		foreach ($items as $footnote_id => $meta) {
			$content = isset($footnotes[$footnote_id]) ? $footnotes[$footnote_id] : '';
			$item_id = self::get_footnote_item_id($footnote_id);
			$backlinks = array();

			for ($i = 1; $i <= $meta['references']; $i++) {
				$ref_id = self::get_footnote_reference_id($footnote_id, $i);
				$backlinks[] = '<a class="mpe-footnote-backref" href="#' . esc_attr($ref_id) . '" aria-label="' . esc_attr__('Back to reference', 'mpe') . '">&#8617;</a>';
			}

			$empty_footnotes = array();
			$empty_state = array(
				'next_number' => 1,
				'items' => array(),
				'inline_next' => 1,
			);
			$rendered = self::render_inline($content, true, $empty_footnotes, $empty_state);
			$html .= '<li id="' . esc_attr($item_id) . '">' . $rendered . ' ' . implode(' ', $backlinks) . '</li>';
		}

		$html .= '</ol></section>';

		return $html;
	}

	private static function render_inline(string $text, bool $preserve_line_breaks, array &$footnotes, array &$footnote_state): string {
		$placeholders = array();
		$index = 0;

		$text = preg_replace_callback(
			'/!\[([^\]]*)\]\((\S+?)(?:\s+=([0-9]+)x)?\)/',
			static function (array $matches) use (&$placeholders, &$index): string {
				$token = '@@MPE' . $index . '@@';
				$index++;
				$alt = esc_attr($matches[1]);
				$url = esc_url($matches[2]);
				$width = isset($matches[3]) ? absint($matches[3]) : 0;
				$style = $width > 0 ? ' style="width:' . $width . 'px; max-width:100%; height:auto;"' : ' style="max-width:100%; height:auto;"';
				$placeholders[$token] = '<img src="' . $url . '" alt="' . $alt . '"' . $style . ' />';
				return $token;
			},
			$text
		);

		$text = preg_replace_callback(
			'/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^)]+)\)/',
			static function (array $matches) use (&$placeholders, &$index): string {
				$token = '@@MPE' . $index . '@@';
				$index++;
				$href = isset($matches[2][0]) && $matches[2][0] === '#'
					? '#' . self::normalize_anchor_target(substr($matches[2], 1))
					: esc_url($matches[2]);
				$placeholders[$token] = '<a href="' . esc_attr($href) . '">' . esc_html($matches[1]) . '</a>';
				return $token;
			},
			$text
		);

		$text = preg_replace_callback(
			'/`([^`]+)`/',
			static function (array $matches) use (&$placeholders, &$index): string {
				$token = '@@MPE' . $index . '@@';
				$index++;
				$placeholders[$token] = '<code>' . esc_html($matches[1]) . '</code>';
				return $token;
			},
			$text
		);

		$text = preg_replace_callback(
			'/\^\[([^\]]+)\]|\[\^([^\]]+)\]/',
			static function (array $matches) use (&$placeholders, &$index, &$footnotes, &$footnote_state): string {
				$token = '@@MPE' . $index . '@@';
				$index++;

				if (isset($matches[1]) && $matches[1] !== '') {
					if (!isset($footnote_state['inline_next'])) {
						$footnote_state['inline_next'] = 1;
					}
					$footnote_id = 'inline-' . $footnote_state['inline_next'];
					$footnote_state['inline_next']++;
					$footnotes[$footnote_id] = $matches[1];
				} else {
					$footnote_id = trim($matches[2]);
				}

				$placeholders[$token] = self::render_footnote_reference($footnote_id, $footnote_state);
				return $token;
			},
			$text
		);

		$text = preg_replace_callback(
			'/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/s',
			static function (array $matches) use (&$placeholders, &$index): string {
				$token = '@@MPE' . $index . '@@';
				$index++;
				$math = trim($matches[1]);
				$placeholders[$token] = '<span class="mpe-math-inline" data-math="' . esc_attr($math) . '">' . esc_html($math) . '</span>';
				return $token;
			},
			$text
		);

		$text = esc_html($text);
		$text = preg_replace('/~~(.+?)~~/s', '<del>$1</del>', $text);
		$text = preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $text);
		$text = preg_replace('/\*(.+?)\*/s', '<em>$1</em>', $text);

		if ($preserve_line_breaks) {
			$text = nl2br($text);
		}

		return strtr($text, $placeholders);
	}
}
