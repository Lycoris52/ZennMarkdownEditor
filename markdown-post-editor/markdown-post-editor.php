<?php
/**
 * Plugin Name: Markdown Post Editor
 * Description: Zenn Style Markdown editor
 * Version: 0.1.0
 * Author: Lycoris52
 */

if (!defined('ABSPATH')) {
	exit;
}

require_once __DIR__ . '/includes/class-mpe-markdown-parser.php';

final class MPE_Plugin {
	private const MENU_SLUG = 'mpe-markdown-posts';
	private const NONCE_ACTION = 'mpe_editor_nonce';
	private const MARKDOWN_META_KEY = '_mpe_markdown_source';
	private const SHIKI_VERSION = '4.0.2';
	private const KATEX_VERSION = '0.16.25';

	public static function bootstrap(): void {
		$instance = new self();
		$instance->register_hooks();
	}

	private function register_hooks(): void {
		add_action('admin_menu', array($this, 'register_admin_menu'));
		add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));
		add_action('wp_enqueue_scripts', array($this, 'enqueue_frontend_assets'));
		add_action('wp_ajax_mpe_save_post', array($this, 'ajax_save_post'));
		add_action('wp_ajax_mpe_upload_image', array($this, 'ajax_upload_image'));
		add_action('the_post', array($this, 'prepare_frontend_post_content'));
		add_filter('the_posts', array($this, 'prepare_frontend_posts'), 9, 2);
		add_filter('the_content', array($this, 'render_frontend_content'), 999);
	}

	public function register_admin_menu(): void {
		add_menu_page(
			__('Markdown Posts', 'mpe'),
			__('Markdown Posts', 'mpe'),
			'edit_posts',
			self::MENU_SLUG,
			array($this, 'render_admin_page'),
			'dashicons-edit-page',
			21
		);
	}

	public function enqueue_admin_assets(string $hook_suffix): void {
		if ($hook_suffix !== 'toplevel_page_' . self::MENU_SLUG) {
			return;
		}

		$asset_version = '0.3.1';
		wp_enqueue_media();

		wp_enqueue_style(
			'mpe-code-highlighter',
			plugins_url('assets/code-highlighter.css', __FILE__),
			array(),
			$asset_version
		);

		wp_enqueue_style(
			'mpe-admin',
			plugins_url('assets/admin.css', __FILE__),
			array('mpe-code-highlighter'),
			$asset_version
		);

		wp_enqueue_script(
			'mpe-embed-renderer',
			plugins_url('assets/embed-renderer.js', __FILE__),
			array(),
			$asset_version,
			true
		);

		wp_enqueue_script(
			'mpe-math-renderer',
			plugins_url('assets/math-renderer.js', __FILE__),
			array(),
			$asset_version,
			true
		);

		wp_enqueue_script(
			'mpe-code-highlighter',
			plugins_url('assets/code-highlighter.js', __FILE__),
			array(),
			$asset_version,
			true
		);

		$this->localize_runtime_asset_config('mpe-math-renderer');
		$this->localize_runtime_asset_config('mpe-code-highlighter');

		wp_enqueue_script(
			'mpe-admin',
			plugins_url('assets/admin.js', __FILE__),
			array('mpe-code-highlighter', 'mpe-math-renderer', 'mpe-embed-renderer', 'media-editor', 'media-views'),
			$asset_version,
			true
		);

		wp_localize_script(
			'mpe-admin',
			'MPE_Admin',
			array(
				'ajaxUrl' => admin_url('admin-ajax.php'),
				'nonce' => wp_create_nonce(self::NONCE_ACTION),
				'previewBaseUrl' => home_url('/?p='),
				'previewFallback' => __('Preview updates as you type.', 'mpe'),
				'uploadingText' => __('Uploading image...', 'mpe'),
				'savingText' => __('Saving', 'mpe'),
				'autosavingText' => __('Autosaving...', 'mpe'),
				'autosavedText' => __('Autosaved.', 'mpe'),
				'saveFailedText' => __('Save failed.', 'mpe'),
				'uploadFailedText' => __('Image upload failed.', 'mpe'),
				'previewUnavailableText' => __('Save the post once before opening the preview page.', 'mpe'),
				'saveButtonIdleText' => __('Save Post', 'mpe'),
				'saveButtonDirtyText' => __('Save Change', 'mpe'),
				'saveButtonSavingText' => __('Saving', 'mpe'),
				'saveButtonSavedText' => __('Post Saved', 'mpe'),
				'featuredImageTitle' => __('Select featured image', 'mpe'),
				'featuredImageButton' => __('Use this image', 'mpe'),
			)
		);
	}

	public function enqueue_frontend_assets(): void {
		$asset_version = '0.3.1';

		wp_enqueue_style(
			'mpe-code-highlighter',
			plugins_url('assets/code-highlighter.css', __FILE__),
			array(),
			$asset_version
		);

		wp_enqueue_style(
			'mpe-frontend-content',
			plugins_url('assets/frontend-content.css', __FILE__),
			array('mpe-code-highlighter'),
			$asset_version
		);

		wp_enqueue_script(
			'mpe-embed-renderer',
			plugins_url('assets/embed-renderer.js', __FILE__),
			array(),
			$asset_version,
			true
		);

		wp_enqueue_script(
			'mpe-math-renderer',
			plugins_url('assets/math-renderer.js', __FILE__),
			array(),
			$asset_version,
			true
		);

		wp_enqueue_script(
			'mpe-code-highlighter',
			plugins_url('assets/code-highlighter.js', __FILE__),
			array('mpe-math-renderer', 'mpe-embed-renderer'),
			$asset_version,
			true
		);

		$this->localize_runtime_asset_config('mpe-math-renderer');
		$this->localize_runtime_asset_config('mpe-code-highlighter');
	}

	private function localize_runtime_asset_config(string $handle): void {
		wp_add_inline_script(
			$handle,
			'window.MPE_Assets = Object.assign({}, window.MPE_Assets || {}, ' . wp_json_encode($this->get_runtime_asset_config()) . ');',
			'before'
		);
	}

	private function get_runtime_asset_config(): array {
		return array(
			'katexCssUrl' => sprintf(
				'https://cdn.jsdelivr.net/npm/katex@%1$s/dist/katex.min.css',
				rawurlencode(self::KATEX_VERSION)
			),
			'katexJsUrl' => sprintf(
				'https://cdn.jsdelivr.net/npm/katex@%1$s/dist/katex.min.js',
				rawurlencode(self::KATEX_VERSION)
			),
			'shikiModuleUrl' => sprintf(
				'https://esm.sh/shiki@%1$s/bundle/web?target=es2020',
				rawurlencode(self::SHIKI_VERSION)
			),
		);
	}

	public function render_frontend_content(string $content): string {
		if (is_admin() || !is_singular('post')) {
			return $content;
		}

		$post_id = get_the_ID();
		if (!$post_id) {
			$queried_object_id = get_queried_object_id();
			$post_id = $queried_object_id ? (int) $queried_object_id : 0;
		}

		if (!$post_id) {
			return $content;
		}

		$markdown = get_post_meta($post_id, self::MARKDOWN_META_KEY, true);
		if (!is_string($markdown) || $markdown === '') {
			return $content;
		}

		return MPE_Markdown_Parser::render($markdown);
	}

	public function prepare_frontend_post_content(\WP_Post $post): void {
		if (is_admin() || !is_singular('post') || !$post instanceof \WP_Post || $post->post_type !== 'post') {
			return;
		}

		if ((int) $post->ID !== (int) get_queried_object_id()) {
			return;
		}

		$markdown = get_post_meta($post->ID, self::MARKDOWN_META_KEY, true);
		if (!is_string($markdown) || $markdown === '') {
			return;
		}

		$post->post_content = MPE_Markdown_Parser::render($markdown);
	}

	public function prepare_frontend_posts(array $posts, \WP_Query $query): array {
		if (is_admin() || !is_singular('post') || empty($posts)) {
			return $posts;
		}

		$target_post_id = (int) get_queried_object_id();
		if ($target_post_id <= 0) {
			return $posts;
		}

		foreach ($posts as $post) {
			if (!$post instanceof \WP_Post || $post->post_type !== 'post' || (int) $post->ID !== $target_post_id) {
				continue;
			}

			$markdown = get_post_meta($post->ID, self::MARKDOWN_META_KEY, true);
			if (!is_string($markdown) || $markdown === '') {
				continue;
			}

			$post->post_content = MPE_Markdown_Parser::render($markdown);
		}

		return $posts;
	}

	public function render_admin_page(): void {
		if (!current_user_can('edit_posts')) {
			wp_die(esc_html__('You do not have permission to access this page.', 'mpe'));
		}

		$view = isset($_GET['view']) ? sanitize_key(wp_unslash($_GET['view'])) : 'list';

		echo '<div class="wrap mpe-admin-wrap">';
		echo '<h1>' . esc_html__('Markdown Posts', 'mpe') . '</h1>';

		if ($view === 'edit') {
			$this->render_editor_page();
		} else {
			$this->render_list_page();
		}

		echo '</div>';
	}

	private function render_list_page(): void {
		$posts = get_posts(
			array(
				'post_type' => 'post',
				'post_status' => array('draft', 'pending', 'future', 'private', 'publish'),
				'numberposts' => 50,
				'orderby' => 'modified',
				'order' => 'DESC',
			)
		);

		$create_url = admin_url('admin.php?page=' . self::MENU_SLUG . '&view=edit');

		echo '<div class="mpe-toolbar">';
		echo '<a class="page-title-action" href="' . esc_url($create_url) . '">' . esc_html__('Add New Markdown Post', 'mpe') . '</a>';
		echo '</div>';

		echo '<table class="widefat striped mpe-post-table">';
		echo '<thead><tr>';
		echo '<th>' . esc_html__('Title', 'mpe') . '</th>';
		echo '<th>' . esc_html__('Status', 'mpe') . '</th>';
		echo '<th>' . esc_html__('Modified', 'mpe') . '</th>';
		echo '<th>' . esc_html__('Source', 'mpe') . '</th>';
		echo '<th>' . esc_html__('Actions', 'mpe') . '</th>';
		echo '</tr></thead><tbody>';

		if (empty($posts)) {
			echo '<tr><td colspan="5">' . esc_html__('No posts found.', 'mpe') . '</td></tr>';
		}

		foreach ($posts as $post) {
			$edit_url = admin_url('admin.php?page=' . self::MENU_SLUG . '&view=edit&post_id=' . absint($post->ID));
			$has_markdown = metadata_exists('post', $post->ID, self::MARKDOWN_META_KEY);

			echo '<tr>';
			echo '<td>' . esc_html(get_the_title($post) ?: __('(no title)', 'mpe')) . '</td>';
			echo '<td>' . esc_html($post->post_status) . '</td>';
			echo '<td>' . esc_html(get_the_modified_date('', $post)) . '</td>';
			echo '<td>' . esc_html($has_markdown ? __('Markdown', 'mpe') : __('Legacy content', 'mpe')) . '</td>';
			echo '<td>';
			echo '<a class="button button-secondary" href="' . esc_url($edit_url) . '">' . esc_html__('Edit in Markdown', 'mpe') . '</a> ';
			echo '<a class="button button-secondary" href="' . esc_url(get_permalink($post)) . '" target="_blank" rel="noopener noreferrer">' . esc_html__('View', 'mpe') . '</a>';
			echo '</td>';
			echo '</tr>';
		}

		echo '</tbody></table>';
	}

	private function render_editor_page(): void {
		$post_id = isset($_GET['post_id']) ? absint($_GET['post_id']) : 0;
		$post = null;
		$markdown = '';
		$title = '';
		$status = 'draft';
		$is_legacy = false;
		$featured_image_id = 0;
		$featured_image_url = '';
		$selected_categories = array();
		$tag_names = array();

		if ($post_id > 0) {
			$post = get_post($post_id);
			if (!$post || $post->post_type !== 'post' || !current_user_can('edit_post', $post_id)) {
				wp_die(esc_html__('Invalid post.', 'mpe'));
			}

			$title = $post->post_title;
			$status = $post->post_status;
			$markdown = (string) get_post_meta($post_id, self::MARKDOWN_META_KEY, true);
			$is_legacy = $markdown === '';
			$featured_image_id = (int) get_post_thumbnail_id($post_id);
			$featured_image_url = $featured_image_id > 0 ? (string) wp_get_attachment_image_url($featured_image_id, 'medium') : '';
			$selected_categories = wp_get_post_categories($post_id, array('fields' => 'ids'));
			$tag_names = wp_get_post_tags($post_id, array('fields' => 'names'));
		}

		$all_categories = get_categories(
			array(
				'taxonomy' => 'category',
				'hide_empty' => false,
			)
		);
		$tags_value = implode(', ', $tag_names);

		$preview_html = $markdown !== '' ? MPE_Markdown_Parser::render($markdown) : '<p class="mpe-empty-preview">' . esc_html__('Preview updates as you type.', 'mpe') . '</p>';

		echo '<div id="mpe-editor-app" class="mpe-editor-app">';
		echo '<div class="mpe-top-fields">';
		echo '<label>';
		echo '<span>' . esc_html__('Title', 'mpe') . '</span>';
		echo '<input type="text" id="mpe-post-title" value="' . esc_attr($title) . '" class="regular-text" />';
		echo '</label>';

		echo '<label>';
		echo '<span>' . esc_html__('Status', 'mpe') . '</span>';
		echo '<select id="mpe-post-status">';
		foreach (array('draft', 'pending', 'publish', 'private') as $allowed_status) {
			echo '<option value="' . esc_attr($allowed_status) . '"' . selected($status, $allowed_status, false) . '>' . esc_html(ucfirst($allowed_status)) . '</option>';
		}
		echo '</select>';
		echo '</label>';
		echo '<div class="mpe-actions">';
		echo '<button type="button" class="button button-primary" id="mpe-save-post">' . esc_html__('Save Post', 'mpe') . '</button>';
		echo '<button type="button" class="button" id="mpe-preview-page">' . esc_html__('Preview Page', 'mpe') . '</button>';
		echo '<a class="button" href="' . esc_url(admin_url('admin.php?page=' . self::MENU_SLUG)) . '">' . esc_html__('Back to List', 'mpe') . '</a>';
		echo '</div>';
		echo '</div>';

		echo '<div class="mpe-meta-row">';
		echo '<div class="mpe-inline-meta mpe-inline-featured">';
		echo '<span>' . esc_html__('Featured Image', 'mpe') . '</span>';
		echo '<div class="mpe-featured-image-inline">';
		echo '<div class="mpe-featured-image-preview mpe-featured-image-preview-inline">';
		if ($featured_image_url !== '') {
			echo '<img id="mpe-featured-image-preview" src="' . esc_url($featured_image_url) . '" alt="" />';
			echo '<div id="mpe-featured-image-placeholder" class="mpe-featured-image-placeholder" style="display:none;">' . esc_html__('No featured image selected.', 'mpe') . '</div>';
		} else {
			echo '<div id="mpe-featured-image-placeholder" class="mpe-featured-image-placeholder">' . esc_html__('No featured image selected.', 'mpe') . '</div>';
			echo '<img id="mpe-featured-image-preview" src="" alt="" style="display:none;" />';
		}
		echo '</div>';
		echo '<div class="mpe-featured-image-actions">';
		echo '<button type="button" class="button" id="mpe-featured-image-select">' . esc_html__('Select Image', 'mpe') . '</button>';
		echo '<button type="button" class="button button-link-delete" id="mpe-featured-image-remove"' . ($featured_image_id > 0 ? '' : ' style="display:none;"') . '>' . esc_html__('Remove Image', 'mpe') . '</button>';
		echo '</div>';
		echo '<input type="hidden" id="mpe-featured-image-id" value="' . esc_attr((string) $featured_image_id) . '" />';
		echo '</div>';
		echo '</div>';

		echo '<div class="mpe-meta-stack">';
		echo '<div class="mpe-inline-meta mpe-inline-categories">';
		echo '<span>' . esc_html__('Categories', 'mpe') . '</span>';
		echo '<div class="mpe-taxonomy-list mpe-taxonomy-list-inline" id="mpe-category-list">';
		foreach ($all_categories as $category) {
			echo '<label class="mpe-taxonomy-item">';
			echo '<input type="checkbox" class="mpe-category-checkbox" value="' . esc_attr((string) $category->term_id) . '"' . checked(in_array((int) $category->term_id, $selected_categories, true), true, false) . ' />';
			echo '<span>' . esc_html($category->name) . '</span>';
			echo '</label>';
		}
		echo '</div>';
		echo '</div>';

		echo '<label class="mpe-inline-meta mpe-inline-tags">';
		echo '<span>' . esc_html__('Tags', 'mpe') . '</span>';
		echo '<input type="text" id="mpe-post-tags" class="regular-text" value="' . esc_attr($tags_value) . '" placeholder="' . esc_attr__('tag1, tag2, tag3', 'mpe') . '" />';
		echo '</label>';
		echo '</div>';
		echo '<div class="mpe-meta-spacer" aria-hidden="true"></div>';
		echo '</div>';

		if ($is_legacy) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html__('This post does not have stored Markdown source yet. Saving from this screen will replace its content with the Markdown you enter here.', 'mpe') . '</p></div>';
		}

		echo '<div class="mpe-workspace">';
		echo '<section class="mpe-pane">';
		echo '<h2>' . esc_html__('Markdown', 'mpe') . '</h2>';
		echo '<textarea id="mpe-markdown-editor" spellcheck="false" placeholder="' . esc_attr__('Write Markdown here. Paste an image directly from the clipboard to upload it.', 'mpe') . '">' . esc_textarea($markdown) . '</textarea>';
		echo '<p class="description">' . esc_html__('Image resize syntax: ![](https://imageurl =250x)', 'mpe') . '</p>';
		echo '</section>';

		echo '<section class="mpe-pane">';
		echo '<h2>' . esc_html__('Preview', 'mpe') . '</h2>';
		echo '<div id="mpe-preview" class="mpe-preview">' . wp_kses_post($preview_html) . '</div>';
		echo '</section>';
		echo '</div>';

		echo '<div id="mpe-status" class="mpe-status" aria-live="polite"></div>';
		echo '<input type="hidden" id="mpe-post-id" value="' . esc_attr((string) $post_id) . '" />';
		echo '</div>';
	}

	public function ajax_save_post(): void {
		check_ajax_referer(self::NONCE_ACTION, 'nonce');

		if (!current_user_can('edit_posts')) {
			wp_send_json_error(array('message' => __('You do not have permission to save posts.', 'mpe')), 403);
		}

		$post_id = isset($_POST['post_id']) ? absint($_POST['post_id']) : 0;
		$title = isset($_POST['title']) ? sanitize_text_field(wp_unslash($_POST['title'])) : '';
		$status = isset($_POST['status']) ? sanitize_key(wp_unslash($_POST['status'])) : 'draft';
		$markdown = isset($_POST['markdown']) ? wp_unslash($_POST['markdown']) : '';
		$featured_image_id = isset($_POST['featured_image_id']) ? absint($_POST['featured_image_id']) : 0;
		$categories = isset($_POST['categories']) ? (array) wp_unslash($_POST['categories']) : array();
		$categories = array_values(array_filter(array_map('absint', $categories)));
		$tags_raw = isset($_POST['tags']) ? sanitize_text_field(wp_unslash($_POST['tags'])) : '';
		$tags = array_values(array_filter(array_map('trim', explode(',', $tags_raw)), static function (string $tag): bool {
			return $tag !== '';
		}));
		$allowed_statuses = array('draft', 'pending', 'publish', 'private');

		if (!in_array($status, $allowed_statuses, true)) {
			$status = 'draft';
		}

		if ($post_id > 0 && !current_user_can('edit_post', $post_id)) {
			wp_send_json_error(array('message' => __('You do not have permission to edit this post.', 'mpe')), 403);
		}

		$post_data = array(
			'post_type' => 'post',
			'post_title' => $title,
			'post_status' => $status,
			'post_content' => MPE_Markdown_Parser::render($markdown),
		);

		if ($post_id > 0) {
			$post_data['ID'] = $post_id;
			$result = wp_update_post(wp_slash($post_data), true);
		} else {
			$result = wp_insert_post(wp_slash($post_data), true);
		}

		if (is_wp_error($result)) {
			wp_send_json_error(array('message' => $result->get_error_message()), 500);
		}

		update_post_meta((int) $result, self::MARKDOWN_META_KEY, wp_slash($markdown));
		wp_set_post_terms((int) $result, $categories, 'category', false);
		wp_set_post_terms((int) $result, $tags, 'post_tag', false);

		if ($featured_image_id > 0) {
			update_post_meta((int) $result, '_thumbnail_id', $featured_image_id);
		} else {
			delete_post_meta((int) $result, '_thumbnail_id');
		}

		$saved_featured_image_url = $featured_image_id > 0 ? (string) wp_get_attachment_image_url($featured_image_id, 'medium') : '';

		wp_send_json_success(
			array(
				'postId' => (int) $result,
				'editUrl' => admin_url('admin.php?page=' . self::MENU_SLUG . '&view=edit&post_id=' . (int) $result),
				'viewUrl' => get_permalink((int) $result),
				'html' => MPE_Markdown_Parser::render($markdown),
				'featuredImageId' => $featured_image_id,
				'featuredImageUrl' => $saved_featured_image_url,
				'categories' => array_map('intval', wp_get_post_categories((int) $result, array('fields' => 'ids'))),
				'tags' => wp_get_post_tags((int) $result, array('fields' => 'names')),
				'message' => __('Post saved.', 'mpe'),
			)
		);
	}

	public function ajax_upload_image(): void {
		check_ajax_referer(self::NONCE_ACTION, 'nonce');

		if (!current_user_can('upload_files')) {
			wp_send_json_error(array('message' => __('You do not have permission to upload files.', 'mpe')), 403);
		}

		if (empty($_FILES['image'])) {
			wp_send_json_error(array('message' => __('No image was uploaded.', 'mpe')), 400);
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$attachment_id = media_handle_upload('image', 0);

		if (is_wp_error($attachment_id)) {
			wp_send_json_error(array('message' => $attachment_id->get_error_message()), 500);
		}

		$image_url = wp_get_attachment_url($attachment_id);

		if (!$image_url) {
			wp_send_json_error(array('message' => __('The image uploaded but no URL was generated.', 'mpe')), 500);
		}

		wp_send_json_success(
			array(
				'attachmentId' => $attachment_id,
				'url' => $image_url,
				'markdown' => '![](' . esc_url_raw($image_url) . ')',
				'message' => __('Image uploaded.', 'mpe'),
			)
		);
	}
}

MPE_Plugin::bootstrap();
